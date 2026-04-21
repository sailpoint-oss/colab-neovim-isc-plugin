local utils = require("sailpoint.utils")

local M = {}

function M.render_item(lines, nodes, item, resource_type, indent, total_width, config)
	local name = utils.resource_label(item)
	if type(name) ~= "string" then
		name = tostring(name)
	end
	if resource_type == "tenants" and item.isActive then
		name = name .. " *"
	end

	local count_str = nil
	if resource_type == "accounts" and type(item.cloudLifecycleState) == "string" then
		if item.cloudLifecycleState ~= "active" then
			count_str = "(" .. item.cloudLifecycleState .. ")"
		end
	end

	local item_line = utils.truncate_sidebar_line(indent, name, count_str, total_width)
	table.insert(lines, item_line)
	table.insert(nodes, {
		type = "item",
		id = utils.resource_key(item),
		resource_type = resource_type,
		value = item,
	})
end

function M.render_account_sources(lines, nodes, items, config, total_width)
	for _, source in ipairs(items) do
		local s_expanded = config.sidebar_state.expanded_sources[source.id]
		local s_icon = s_expanded and "▼" or "▶"
		local count_str = string.format("(%d)", source.count or 0)

		local source_line = utils.truncate_sidebar_line("   ", s_icon .. " " .. source.name, count_str, total_width)
		table.insert(lines, source_line)
		table.insert(nodes, { type = "account_source", id = source.id, name = source.name })

		if s_expanded then
			local s_items = config.raw_cache["accounts_" .. source.id]
			if type(s_items) == "table" then
				local s_total = #s_items
				local s_limit = 10
				local s_show_all = config.fully_expanded["accounts_" .. source.id]

				local s_display_count = (s_show_all or s_total <= s_limit) and s_total or s_limit

				for i = 1, s_display_count do
					M.render_item(lines, nodes, s_items[i], "accounts", "      ", total_width, config)
				end

				if not s_show_all and s_total > s_limit then
					table.insert(lines, "      ...")
					table.insert(nodes, { type = "more_accounts", id = source.id })
				end
			else
				table.insert(lines, "      (Loading...)")
				table.insert(nodes, { type = "loading" })
			end
		end
	end
end

function M.render_sources(lines, nodes, items, config, total_width)
	for _, source in ipairs(items) do
		local s_expanded = config.sidebar_state.expanded_sources[source.id]
		local s_icon = s_expanded and "▼" or "▶"

		local source_line = utils.truncate_sidebar_line("   ", s_icon .. " " .. source.name, nil, total_width)
		table.insert(lines, source_line)
		table.insert(nodes, { type = "source_item", id = source.id, name = source.name, value = source })

		if s_expanded then
			-- Render "Main Configuration"
			local main_line = utils.truncate_sidebar_line("      ", "Main Configuration", nil, total_width)
			table.insert(lines, main_line)
			table.insert(nodes, { type = "item", id = source.id, resource_type = "sources", value = source })

			-- Render Schemas folder
			local schemas_expanded = config.sidebar_state.expanded_source_folders[source.id .. "_schemas"]
			local schemas_icon = schemas_expanded and "▼" or "▶"
			local schemas_line = utils.truncate_sidebar_line("      ", schemas_icon .. " Schemas", nil, total_width)
			table.insert(lines, schemas_line)
			table.insert(nodes, {
				type = "source_folder",
				id = source.id .. "_schemas",
				source_id = source.id,
				folder_type = "schemas",
			})

			if schemas_expanded then
				if type(source.schemas) == "table" and #source.schemas > 0 then
					for _, schema in ipairs(source.schemas) do
						local schema_line = utils.truncate_sidebar_line("         ", schema.name, nil, total_width)
						table.insert(lines, schema_line)
						table.insert(nodes, {
							type = "source_sub_item",
							id = schema.id,
							source_id = source.id,
							sub_type = "schemas",
							value = schema,
						})
					end
				else
					table.insert(lines, "         (No Schemas)")
					table.insert(nodes, { type = "empty" })
				end
			end

			-- Render Provisioning Policies folder
			local policies_expanded = config.sidebar_state.expanded_source_folders[source.id .. "_policies"]
			local policies_icon = policies_expanded and "▼" or "▶"
			local policies_line =
				utils.truncate_sidebar_line("      ", policies_icon .. " Provisioning Policies", nil, total_width)
			table.insert(lines, policies_line)
			table.insert(nodes, {
				type = "source_folder",
				id = source.id .. "_policies",
				source_id = source.id,
				folder_type = "policies",
			})

			if policies_expanded then
				if type(source.provisioningPolicies) == "table" and #source.provisioningPolicies > 0 then
					for _, policy in ipairs(source.provisioningPolicies) do
						local policy_line = utils.truncate_sidebar_line("         ", policy.name, nil, total_width)
						table.insert(lines, policy_line)
						table.insert(nodes, {
							type = "source_sub_item",
							id = policy.usageType or policy.id,
							source_id = source.id,
							sub_type = "policies",
							value = policy,
						})
					end
				else
					table.insert(lines, "         (No Policies)")
					table.insert(nodes, { type = "empty" })
				end
			end
		end
	end
end

function M.render_category(lines, nodes, res_type, config, total_width)
	local items = config.raw_cache[res_type.id]
	if type(items) == "table" and #items > 0 then
		local show_all = config.fully_expanded[res_type.id]
		local total = #items
		if res_type.id == "accounts" then
			M.render_account_sources(lines, nodes, items, config, total_width)
		elseif res_type.id == "sources" then
			M.render_sources(lines, nodes, items, config, total_width)
		else
			local actual_total = config.total_counts[res_type.id] or total
			local display_limit = 10

			if show_all or actual_total <= display_limit then
				for i = 1, total do
					M.render_item(lines, nodes, items[i], res_type.id, "   ", total_width, config)
				end
			else
				for i = 1, math.min(total, display_limit) do
					M.render_item(lines, nodes, items[i], res_type.id, "   ", total_width, config)
				end
				table.insert(lines, "   ...")
				table.insert(nodes, { type = "more", id = res_type.id })
			end
		end
	elseif items == nil then
		table.insert(lines, "   (Loading...)")
		table.insert(nodes, { type = "loading" })
	else
		-- Empty list - pressing Enter will fetch this resource
		table.insert(lines, "   (No Items)")
		table.insert(nodes, { type = "fetch_empty", id = res_type.id })
	end
end

return M
