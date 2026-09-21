import packageJSON from '../../../package.json';
import { readFileSync } from 'fs-extra';
import { join } from 'path';
import { getConfigManager } from '../../utcp/config-manager';

module.exports = Editor.Panel.define({
    listeners: {
        show() { console.log('show'); },
        hide() { console.log('hide'); },
    },
    template: readFileSync(join(__dirname, '../../../static/template/configuration/index.html'), 'utf-8'),
    style: readFileSync(join(__dirname, '../../../static/style/configuration/index.css'), 'utf-8'),
    $: {
        app: '.panel',
        portInput: '#port-input',
        savePortBtn: '#save-port-btn',

        // MCP Integration
        mcpConfigCode: '#mcp-config-code',
        
        // UTCP Config
        utcpConfigPathInput: '#utcp-config-path',
        utcpConfigPathSaveBtn: '#save-utcp-path-btn',
        pilotList: '#pilot-container',
        addPilotBtn: '#add-pilot-btn',
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

            // Load Port
            const port = await configManager.getCurrentPort();
            if (this.$.portInput) {
                (this.$.portInput as any).value = port || 0;
            }

            this.updateMcpCodeBlock();
            this.fetchPilotList();
        },

        async saveSettings() {
            const newPath = (this.$.utcpConfigPathInput as any).value;
            if (newPath) {
                const configManager = getConfigManager();
                await configManager.setConfigPath(newPath);
                this.updateMcpCodeBlock();
                this.fetchPilotList(); // Reload templates from new path
                console.log('Saved UTCP Config Path:', newPath);
            }
        },

        async updatePort() {
            const portVal = (this.$.portInput as any).value;
            const port = parseInt(portVal);
            console.log(`Updating port to: ${port}`);
            // Send message to main process to restart server
            Editor.Message.send(packageJSON.name, 'restart-server', port);
        },

        updateMcpCodeBlock() {
            const codeEl = this.$.mcpConfigCode as HTMLElement;
            if (!codeEl) return;

            const configManager = getConfigManager();
            const configPath = configManager.getConfigPath();

            const config = {
                "mcpServers": {
                    "cc-pilot": {
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

        fetchPilotList() {
            const container = this.$.pilotList as HTMLElement;
            if (!container) {
                console.warn('Pilot Config Container not found');
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
                const isCocos = /^(ccp3x(_\d+)?|ccp2x(_\d+)?)$/.test(t.name);
                    const delBtn = isCocos
                        ? `` // No delete for Cocos
                        : `<ui-button slot="header" type="danger" class="remove-btn" tooltip="Remove Template">
                             <ui-icon value="del"></ui-icon>
                           </ui-button>`;

                    const headerText = `${t.name} (${t.call_template_type})`;

                    html += `
                    <ui-section class="pilot-item-section" data-name="${t.name}">
                        <div slot="header" style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding-right: 10px;">
                            <ui-label>${headerText}</ui-label>
                            ${delBtn}
                        </div>
                        <div class="pilot-item-content">
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

        addPilotTemplate() {
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
                const config = configManager.readConfig();
                const templates = config.manual_call_templates ?? [];

                // Check duplicates
                if (templates.find((t) => (t['name'] as string) === newTpl.name)) {
                    alert(`Template ${newTpl.name} already exists.`);
                    return;
                }

                templates.push(newTpl as Record<string, unknown>);
                (config as { manual_call_templates: Array<Record<string, unknown>> }).manual_call_templates = templates;
                configManager.writeConfig(config);
                input.value = '';
                this.fetchPilotList();

            } catch (e: any) {
                alert('Invalid JSON: ' + e.message);
            }
        },

        removePilotTemplate(name: string) {
            if (/^(ccp3x(_\d+)?|ccp2x(_\d+)?)$/.test(name)) return;
            if (!confirm(`Remove template ${name}?`)) return;

            const configManager = getConfigManager();
            const config = configManager.readConfig();
            if (config.manual_call_templates) {
                config.manual_call_templates = config.manual_call_templates.filter((t: any) => t.name !== name);
                configManager.writeConfig(config);
                this.fetchPilotList();
            }
        },
    },
    ready() {
        this.loadSettings();

        // Listeners
        const savePort = this.$.savePortBtn as HTMLElement;
        if (savePort) savePort.addEventListener('click', () => this.updatePort());

        const savePath = this.$.utcpConfigPathSaveBtn as HTMLElement;
        if (savePath) savePath.addEventListener('click', () => this.saveSettings());

        const addBtn = this.$.addPilotBtn as HTMLElement;
        if (addBtn) addBtn.addEventListener('click', () => this.addPilotTemplate());

        const list = this.$.pilotList as HTMLElement;
        if (list) {
            list.addEventListener('click', (e: any) => {
                // Handle delete clicks
                const btn = e.target.closest('.remove-btn');
                if (btn) {
                    // In new structure, btn is inside .pilot-item-content inside ui-section
                    const section = btn.closest('.pilot-item-section');
                    if (section && section.dataset.name) {
                        this.removePilotTemplate(section.dataset.name);
                    }
                }
            });
        }
    },
    beforeClose() { },
    close() { },
});