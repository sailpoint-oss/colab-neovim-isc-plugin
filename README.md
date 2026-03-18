[![Discourse Topics][discourse-shield]][discourse-url]
[![Issues][issues-shield]][issues-url]
[![Latest Releases][release-shield]][release-url]
[![Contributor Shield][contributor-shield]][contributors-url]

[discourse-shield]:https://img.shields.io/discourse/topics?label=Discuss%20This%20Tool&server=https%3A%2F%2Fdeveloper.sailpoint.com%2Fdiscuss
[discourse-url]:https://developer.sailpoint.com/discuss/tag/workflows
[issues-shield]:https://img.shields.io/github/issues/sailpoint-oss/repo-template?label=Issues
[issues-url]:https://github.com/sailpoint-oss/repo-template/issues
[release-shield]: https://img.shields.io/github/v/release/sailpoint-oss/repo-template?label=Current%20Release
[release-url]:https://github.com/sailpoint-oss/repo-template/releases
[contributor-shield]:https://img.shields.io/github/contributors/sailpoint-oss/repo-template?label=Contributors
[contributors-url]:https://github.com/sailpoint-oss/repo-template/graphs/contributors

# Neovim ISC Plugin
[Explore the docs »](https://your-link-to-colab-topic-here)

[New to the CoLab? Click here »](https://developer.sailpoint.com/discuss/t/about-the-sailpoint-developer-community-colab/11230)

## Overview
This is a Neovim plugin for working with SailPoint Identity Security Cloud without leaving the editor. It provides a sidebar resource browser, global search, multi-tenant support, and direct JSON editing for common ISC resources such as sources, transforms, roles, access profiles, workflows, connector rules, and related objects. The plugin is designed for developers and administrators who prefer a keyboard-driven workflow and want fast access to tenant configuration and resource management inside Neovim.

## Requirements
Neovim 0.9.0 or newer
Node.js 16.x or newer
npm for backend dependency installation
plenary.nvim installed in Neovim
A SailPoint ISC tenant with Personal Access Token credentials
Supported desktop keychain integration for secure secret storage through keytar
## Guide
Install the plugin with your preferred Neovim plugin manager and run :SPIInstall to install backend dependencies.
Restart Neovim and run :UpdateRemotePlugins. Open the sidebar with :SetSail, then add a tenant with :SailPointAdd tenant.
Once configured, you can browse cached resources, search across object types, open items as JSON buffers, and save changes with :w or :SailPointSave.
The plugin detects the appropriate save behavior automatically for supported resource types and stores PAT credentials securely in the system keychain.

<!-- LICENSE -->
### License

Distributed under the MIT License. See `LICENSE.txt` for more information.

<!-- CONTACT -->
### Discuss
[Click Here](https://developer.sailpoint.com/dicuss/tag/{tagName}) to discuss this tool with other users.
