import { ISCClient } from '../services/ISCClient';
import { TenantService } from '../services/TenantService';
import { dedupeItems } from '../utils/dedupe';
import { logError, logWarn } from '../services/logger';
import { RESOURCE_REGISTRY } from '../resourceRegistry';
import { buildVersionedPath } from '../services/pathTemplates';
import type { ResourceItem, FetchResponse, ResourceMetadata } from '../types/api';

export interface FetcherResponse {
    items: ResourceItem[];
    totalCount: number;
    error?: string;
}

type ProgressHandler = (count: number, detail?: string | number) => void;
type FetchFn = (
    client: ISCClient,
    version: string,
    activeTenantIndex: number,
    query?: string,
    limit?: number,
    onProgress?: ProgressHandler,
    subId?: string
) => Promise<FetcherResponse>;

export class ResourceFetcher {
    constructor(private readonly tenantService: TenantService) {}

    private asArrayItems(payload: unknown): ResourceItem[] {
        if (Array.isArray(payload)) return payload as ResourceItem[];
        if (payload && typeof payload === 'object') {
            const directKeys = ['data', 'items', 'schemas', 'provisioningPolicies', 'results', 'objects'] as const;
            for (const key of directKeys) {
                const value = (payload as Record<string, unknown>)[key];
                if (Array.isArray(value)) return value as ResourceItem[];
            }
            const data = (payload as { data?: unknown }).data;
            if (Array.isArray(data)) return data as ResourceItem[];
            const items = (payload as { items?: unknown }).items;
            if (Array.isArray(items)) return items as ResourceItem[];
        }
        return [];
    }

    private async fetchFirstList(client: ISCClient, paths: string[]): Promise<ResourceItem[]> {
        for (const path of paths) {
            try {
                const response = await client.getResource(path);
                const items = this.asArrayItems(response);
                if (items.length > 0) return items;
            } catch {
                // Try next candidate endpoint/version.
            }
        }
        return [];
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private async getTotalCount(client: ISCClient, resourceType: string, fallback: number): Promise<number> {
        try {
            const metadata = await client.getResourceMetadata(resourceType);
            return Math.max(metadata.totalCount || 0, fallback);
        } catch (e: unknown) {
            logWarn(`SailPoint: metadata fetch failed for ${resourceType}: ${this.getErrorMessage(e)}`);
            return fallback;
        }
    }

    public async fetchWithFallback(client: ISCClient, standardCall: () => Promise<ResourceItem[]>, rawPath: string): Promise<ResourceItem[]> {
        let items: ResourceItem[] = [];
        try { 
            items = await standardCall(); 
        } catch (e: unknown) {
            if (this.getErrorMessage(e).includes('404')) {
                const res = await client.getResource(rawPath);
                if (Array.isArray(res)) {
                    items = res as ResourceItem[];
                } else if (res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)) {
                    items = (res as { data: ResourceItem[] }).data;
                } else {
                    items = [];
                }
            } else { 
                throw e; 
            }
        }
        if (!Array.isArray(items)) return [];
        return dedupeItems(items);
    }

    private async fetchAndCount(client: ISCClient, resourceType: string, load: () => Promise<ResourceItem[]>): Promise<FetcherResponse> {
        const items = await load();
        return {
            items,
            totalCount: await this.getTotalCount(client, resourceType, items.length)
        };
    }

    private createFallbackFetcher(resourceType: string, endpoint: string, load: (client: ISCClient, limit?: number) => Promise<ResourceItem[]>): FetchFn {
        return async (client, version, _activeTenantIndex, _query, limit) =>
            this.fetchAndCount(client, resourceType, () => this.fetchWithFallback(client, () => load(client, limit), buildVersionedPath(version, endpoint)));
    }

    private createSimpleCountFetcher(resourceType: string, load: (client: ISCClient, limit?: number) => Promise<ResourceItem[]>): FetchFn {
        return async (client, _version, _activeTenantIndex, _query, limit) =>
            this.fetchAndCount(client, resourceType, () => load(client, limit));
    }

    private buildRegistryFetchers(): Record<string, FetchFn> {
        const loadByType: Record<string, (c: ISCClient, limit?: number, subId?: string) => Promise<ResourceItem[]>> = {
            sources: async (c, limit, subId) => {
                if (subId) {
                    const base = (await c.getSourceById(subId)) as unknown as ResourceItem;
                    const schemas = await this.fetchFirstList(c, [
                        `/v3/sources/${subId}/schemas`,
                        `/beta/sources/${subId}/schemas`
                    ]);
                    const provisioningPolicies = await this.fetchFirstList(c, [
                        `/v3/sources/${subId}/provisioning-policies`,
                        `/beta/sources/${subId}/provisioning-policies`
                    ]);
                    return [{ ...base, schemas, provisioningPolicies }];
                }
                return (await c.getSources(limit)) as unknown as ResourceItem[];
            },
            transforms: async (c, limit) => (await c.getTransforms(limit)) as unknown as ResourceItem[],
            rules: async (c, limit, subId) => {
                if (subId) return [(await c.getConnectorRuleById(subId)) as unknown as ResourceItem];
                return (await c.getConnectorRules(limit)) as unknown as ResourceItem[];
            },
            workflows: async (c, limit, subId) => {
                if (subId) return [(await c.getWorflow(subId)) as unknown as ResourceItem];
                return (await c.getWorflows(limit)) as unknown as ResourceItem[];
            },
            apps: async (c, limit) => (await c.getPaginatedApplications('', limit)).data as unknown as ResourceItem[],
            entitlements: async (c, limit, subId) => {
                if (subId) return [(await c.getEntitlement(subId)) as unknown as ResourceItem];
                return (await c.listEntitlements(undefined, limit)) as unknown as ResourceItem[];
            },
            campaigns: async (c, limit) => (await c.getPaginatedCampaigns('', limit)).data as unknown as ResourceItem[],
            'service-desk': async (c, limit) => (await c.getServiceDesks(limit)) as unknown as ResourceItem[],
            'identity-profiles': async (c, limit) => (await c.getIdentityProfiles(limit)) as unknown as ResourceItem[],
            forms: async (c, limit) => (await c.listForms(limit)) as unknown as ResourceItem[],
        };

        const generated: Record<string, FetchFn> = {};
        for (const resource of RESOURCE_REGISTRY) {
            const policy = resource.fetchPolicy;
            if (!policy || policy.mode === 'custom') continue;
            const resourceType = policy.metadataType || resource.id;
            const loader = loadByType[resource.id];
            if (!loader) continue;
            if (policy.mode === 'fallback' && policy.endpoint) {
                generated[resource.id] = async (client, version, _activeTenantIndex, _query, limit, _onProgress, subId) =>
                    this.fetchAndCount(client, resourceType, () => this.fetchWithFallback(client, () => loader(client, limit, subId), buildVersionedPath(version, policy.endpoint!)));
            } else if (policy.mode === 'simple') {
                generated[resource.id] = async (client, _version, _activeTenantIndex, _query, limit, _onProgress, subId) =>
                    this.fetchAndCount(client, resourceType, () => loader(client, limit, subId));
            }
        }
        return generated;
    }

    private readonly fetchers: Record<string, FetchFn> = {
        ...this.buildRegistryFetchers(),
        accounts: async (c, _v, __, ___, limit, onProgress, subId) => {
            if (subId) {
                const items = await c.getAccountsForSource(subId, onProgress);
                return { items: items as unknown as ResourceItem[], totalCount: items.length };
            }
            const items = limit ? await c.listAccounts(limit) : await c.getAllAccounts((count, sourceName) => onProgress?.(count, sourceName));
            return this.fetchAndCount(c, 'accounts', async () => items as unknown as ResourceItem[]);
        },
        roles: async (c, v, _, q, limit) => {
            if (q) {
                const items = (await c.paginatedSearchRoles(q, limit || 50)).data as unknown as ResourceItem[];
                return this.fetchAndCount(c, 'roles', async () => items);
            }
            return this.fetchAndCount(c, 'roles', () => this.fetchWithFallback(c, async () => (await c.getAllRoles(limit)) as unknown as ResourceItem[], `/${v}/roles`));
        },
        'access-profiles': async (c, v, _, q, limit) => {
            if (q) {
                const items = (await c.paginatedSearchAccessProfiles(q, limit || 50)).data as unknown as ResourceItem[];
                return this.fetchAndCount(c, 'access-profiles', async () => items);
            }
            return this.fetchAndCount(c, 'access-profiles', () => this.fetchWithFallback(c, async () => (await c.getAccessProfiles(limit)).data as unknown as ResourceItem[], `/${v}/access-profiles`));
        },
        identities: async (c, _v, __, q, limit, onProgress) => {
            const query = q || "*";
            if (limit === undefined && !q) {
                const items = (await c.getAllIdentities((count, total) => onProgress?.(count, total))) as unknown as ResourceItem[];
                return { items, totalCount: items.length };
            }
            const resp = await c.searchIdentities(query, limit || 250);
            return { items: resp.items as unknown as ResourceItem[], totalCount: resp.totalCount || resp.items.length };
        },
        'search-attributes': async (c) => {
            const items = (await c.getSearchAttributes()) as unknown as ResourceItem[];
            return { items, totalCount: items.length };
        },
        'identity-attributes': async (c) => {
            const items = (await c.getIdentityAttributes()) as unknown as ResourceItem[];
            return { items, totalCount: items.length };
        },
        tenants: async (_c, _v, idx) => {
            const items = this.tenantService.getTenants().map((t, i) => ({ id: t.id, name: t.name, tenantName: t.tenantName, isActive: i === idx, version: t.version })) as unknown as ResourceItem[];
            return { items, totalCount: items.length };
        },
        search: async (c, _v, __, q, limit) => {
            const [index, ...rest] = (q || '').split(' ');
            const query = rest.join(' ') || index;
            try {
                const items = (await c.search(index, query, limit)) as ResourceItem[];
                return { items, totalCount: items.length };
            } catch (e: unknown) {
                return { items: [], totalCount: 0, error: this.getErrorMessage(e) };
            }
        }
    };

    public async fetchItemsInternal(type: string, getClient: () => { client: ISCClient, version: string }, activeTenantIndex: number, query?: string, limit?: number, onProgress?: ProgressHandler, subId?: string): Promise<FetcherResponse> {
        try {
            const { client, version } = getClient();
            const fetcher = this.fetchers[type];
            if (fetcher) {
                return await fetcher(client, version, activeTenantIndex, query, limit, onProgress, subId);
            }
        } catch (e: unknown) {
            logError(`Fetch error for ${type}:`, e);
            return { items: [], totalCount: 0, error: this.getErrorMessage(e) };
        }
        return { items: [], totalCount: 0 };
    }
}
