import packageJSON from '../../../package.json';
import { readFileSync } from 'fs-extra';
import { join } from 'path';
import { getConfigManager } from '../../utcp/config-manager';

module.exports = Editor.Panel.define({
    listeners: {},
    template: readFileSync(join(__dirname, '../../../static/template/configuration/index.html'), 'utf-8'),
    style: readFileSync(join(__dirname, '../../../static/style/configuration/index.css'), 'utf-8'),
    $: {
        app: '.panel',
        portInput: '#port-input',
        savePortBtn: '#save-port-btn',
        debugToggle: '#debug-logging-toggle',
        debugStatus: '#debug-logging-status',

        // MCP Integration
        mcpConfigCode: '#mcp-config-code',
        
        // UTCP Config
        utcpConfigPathInput: '#utcp-config-path',
        utcpConfigPathSaveBtn: '#save-utcp-path-btn',
        bridgeList: '#bridge-container',
        addBridgeBtn: '#add-bridge-btn',
        newTemplateJson: '#new-template-json',
    },

    methods: {
        async loadSettings() {
            const configManager = getConfigManager();
            await configManager.initialize();

            // Update UI with config path
            if (this.$.utcpConfigPathInput) {
                (this.$.utcpConfigPathInput as any).value = configManager.getConfigPath();
            }

            // Show the configured preference, not this process's bound auto port.
            const port = await configManager.getCurrentPort();
            if (this.$.portInput) {
                (this.$.portInput as HTMLInputElement).value = String(port);
            }

            this.updateMcpCodeBlock();
            this.fetchBridgeList();
            const debugState = await Editor.Message.request(packageJSON.name, 'get-debug-logging');
            const debugToggle = this.$.debugToggle as HTMLInputElement;
            const debugStatus = this.$.debugStatus as HTMLElement;
            if (debugToggle && debugState && typeof debugState.enabled === 'boolean') debugToggle.checked = debugState.enabled;
            if (debugStatus && debugState) debugStatus.textContent = debugState.enabled ? 'ON — verbose tool lifecycle logs' : 'OFF — warnings and errors only';
        },

        async saveSettings() {
            const newPath = (this.$.utcpConfigPathInput as any).value;
            if (newPath) {
                const configManager = getConfigManager();
                await configManager.setConfigPath(newPath);
                this.updateMcpCodeBlock();
                this.fetchBridgeList(); // Reload templates from new path
                console.log('[cx3][config] Saved UTCP Config Path:', newPath);
            }
        },

        async updatePort() {
            const value = String((this.$.portInput as HTMLInputElement).value).trim();
            const port = Number(value);
            if (!value || !Number.isInteger(port) || port < 0 || port > 65535) {
                alert('Port must be an integer between 0 and 65535 (0 = auto).');
                return;
            }
            try {
                await Editor.Message.request(packageJSON.name, 'restart-server', port);
                await this.loadSettings();
            } catch (error) {
                alert('Failed to restart server: ' + (error instanceof Error ? error.message : String(error)));
            }
        },

        updateMcpCodeBlock() {
            const codeEl = this.$.mcpConfigCode as HTMLElement;
            if (!codeEl) return;

            const configManager = getConfigManager();
            const configPath = configManager.getConfigPath();

            const config = {
                "mcpServers": {
                    "cc-bridge": {
                        "command": "npx",
                        "args": ["-y", "@utcp/code-mode-mcp"],
                        "env": {
                            "UTCP_CONFIG_FILE": configPath
                        }
                    }
                }
            };

            codeEl.textContent = JSON.stringify(config, null, 2);
        },

        fetchBridgeList() {
            const container = this.$.bridgeList as HTMLElement;
            if (!container) {
                console.warn('[cx3][config] Bridge Config Container not found');
                return;
            }

            // Clear "Loading..." or previous content
            container.innerHTML = '';

            const configManager = getConfigManager();
            const config = configManager.readConfig();
            const templates = config.manual_call_templates || [];

            if (templates.length === 0) {
                container.innerHTML = '<div style="padding:10px; color: #888;">No templates found.</div>';
            } else {
                let html = '';
                templates.forEach((t: any) => {
                const isCocos = /^(ccb3x(_\d+)?|ccb2x(_\d+)?)$/.test(t.name);
                    const delBtn = isCocos
                        ? `` // No delete for Cocos
                        : `<ui-button slot="header" type="danger" class="remove-btn" tooltip="Remove Template">
                             <ui-icon value="del"></ui-icon>
                           </ui-button>`;

                    const headerText = `${t.name} (${t.call_template_type})`;

                    html += `
                    <ui-section class="bridge-item-section" data-name="${t.name}">
                        <div slot="header" style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding-right: 10px;">
                            <ui-label>${headerText}</ui-label>
                            ${delBtn}
                        </div>
                        <div class="bridge-item-content">
                             <ui-code language="json" readonly id="code-${t.name}"></ui-code>
                        </div>
                    </ui-section>
                    `;
                });
                container.innerHTML = html;

                // Now populate the code values correctly
                templates.forEach((t: any) => {
                    const el = container.querySelector(`#code-${t.name}`) as any;
                    if (el) el.textContent = JSON.stringify(t, null, 2);
                });
            }
        },

        async addBridgeTemplate() {
            const input = this.$.newTemplateJson as any;
            if (!input) return;
            const content = input.value.trim();
            if (!content) return;

            try {
                let newTpl = JSON.parse(content);
                // Validate with @utcp/sdk or simple schema
                if (!newTpl.name || !newTpl.call_template_type) {
                    alert('Invalid template. Must have name and call_template_type.');
                    return;
                }

                const configManager = getConfigManager();
                const saved = await configManager.mutateConfig(config => {
                    const templates = config.manual_call_templates ?? [];
                    if (templates.some((template: { name: string }) => template.name === newTpl.name)) {
                        throw new Error(`Template ${newTpl.name} already exists.`);
                    }
                    config.manual_call_templates = [...templates, newTpl];
                });
                if (!saved) throw new Error('Unable to save the template.');
                input.value = '';
                this.fetchBridgeList();

            } catch (error) {
                alert('Unable to add template: ' + (error instanceof Error ? error.message : String(error)));
            }
        },

        async removeBridge(name: string) {
            if (/^(ccb3x(_\d+)?|ccb2x(_\d+)?)$/.test(name)) return;
            if (!confirm(`Remove template ${name}?`)) return;

            const configManager = getConfigManager();
            try {
                const saved = await configManager.mutateConfig(config => {
                    config.manual_call_templates = (config.manual_call_templates ?? [])
                        .filter((template: { name: string }) => template.name !== name);
                });
                if (!saved) throw new Error('Unable to save template removal.');
                this.fetchBridgeList();
            } catch (error) {
                alert('Unable to remove template: ' + (error instanceof Error ? error.message : String(error)));
            }
        },
        async setDebugLogging(enabled: boolean) {
            const state = await Editor.Message.request(packageJSON.name, 'set-debug-logging', enabled);
            const debugStatus = this.$.debugStatus as HTMLElement;
            if (debugStatus && state) debugStatus.textContent = state.enabled ? 'ON — verbose tool lifecycle logs' : 'OFF — warnings and errors only';
        },
    },
    ready() {
        this.loadSettings();

        // Listeners
        const debugToggle = this.$.debugToggle as HTMLElement & { checked?: boolean };
        if (debugToggle) debugToggle.addEventListener('change', () => this.setDebugLogging(debugToggle.checked === true));
        const savePort = this.$.savePortBtn as HTMLElement;
        if (savePort) savePort.addEventListener('click', () => this.updatePort());

        const savePath = this.$.utcpConfigPathSaveBtn as HTMLElement;
        if (savePath) savePath.addEventListener('click', () => this.saveSettings());

        const addBtn = this.$.addBridgeBtn as HTMLElement;
        if (addBtn) addBtn.addEventListener('click', () => this.addBridgeTemplate());

        const list = this.$.bridgeList as HTMLElement;
        if (list) {
            list.addEventListener('click', (e: any) => {
                // Handle delete clicks
                const btn = e.target.closest('.remove-btn');
                if (btn) {
                    // In new structure, btn is inside .bridge-item-content inside ui-section
                    const section = btn.closest('.bridge-item-section');
                    if (section && section.dataset.name) {
                        this.removeBridge(section.dataset.name);
                    }
                }
            });
        }
    },
    beforeClose() { },
    close() { },
});