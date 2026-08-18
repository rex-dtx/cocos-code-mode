const Fs = require('fs');
const Path = require('path');
const Os = require('os');

const PKG = 'cocos-code-mode-2x';

function getConfigPath() {
    try {
        const projectPath = Editor.Project ? Editor.Project.path : null;
        if (!projectPath) return Path.join(Os.homedir(), '.utcp_config.json');
        const settingsPath = Path.join(projectPath, 'settings', PKG + '.json');
        if (Fs.existsSync(settingsPath)) {
            const data = JSON.parse(Fs.readFileSync(settingsPath, 'utf8'));
            if (data.utcpConfigPath) return data.utcpConfigPath;
        }
    } catch (e) {}
    return Path.join(Os.homedir(), '.utcp_config.json');
}

function readUtcpConfig() {
    const p = getConfigPath();
    if (!Fs.existsSync(p)) return { manual_call_templates: [] };
    try { return JSON.parse(Fs.readFileSync(p, 'utf8')); } catch (e) { return { manual_call_templates: [] }; }
}

function writeUtcpConfig(cfg) {
    const p = getConfigPath();
    Fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

function getServerPort() {
    try {
        const projectPath = Editor.Project ? Editor.Project.path : null;
        if (!projectPath) return 0;
        const settingsPath = Path.join(projectPath, 'settings', PKG + '.json');
        if (Fs.existsSync(settingsPath)) {
            const data = JSON.parse(Fs.readFileSync(settingsPath, 'utf8'));
            return data.serverPort || 0;
        }
    } catch (e) {}
    return 0;
}

Editor.Panel.define({
    listeners: { show() {}, hide() {} },

    template: (function () {
        try { return Fs.readFileSync(Path.join(__dirname, '../static/template/configuration/index.html'), 'utf-8'); } catch (e) {}
        try { return Fs.readFileSync(Editor.url('packages://' + PKG + '/static/template/configuration/index.html'), 'utf-8'); } catch (e) {}
        return '<div style="padding:20px">Template not found. Check package install.</div>';
    })(),
    style: (function () {
        try { return Fs.readFileSync(Path.join(__dirname, '../static/style/configuration/index.css'), 'utf-8'); } catch (e) {}
        try { return Fs.readFileSync(Editor.url('packages://' + PKG + '/static/style/configuration/index.css'), 'utf-8'); } catch (e) {}
        return '';
    })(),

    $: {
        app: '.panel',
        portInput: '#port-input',
        savePortBtn: '#save-port-btn',
        mcpConfigCode: '#mcp-config-code',
        utcpConfigPathInput: '#utcp-config-path',
        utcpConfigPathSaveBtn: '#save-utcp-path-btn',
        bridgeList: '#bridge-container',
        addBridgeBtn: '#add-bridge-btn',
        newTemplateJson: '#new-template-json',
    },

    methods: {
        loadSettings() {
            if (this.$.utcpConfigPathInput) this.$.utcpConfigPathInput.value = getConfigPath();
            if (this.$.portInput) this.$.portInput.value = getServerPort() || 0;
            this.updateMcpCodeBlock();
            this.fetchBridgeList();
        },

        saveSettings() {
            const newPath = this.$.utcpConfigPathInput && this.$.utcpConfigPathInput.value;
            if (!newPath) return;
            // Update settings file: project/settings/cocos-code-mode-2x.json
            try {
                const projectPath = Editor.Project.path;
                const settingsPath = Path.join(projectPath, 'settings', PKG + '.json');
                let data = {};
                if (Fs.existsSync(settingsPath)) data = JSON.parse(Fs.readFileSync(settingsPath, 'utf8'));
                data.utcpConfigPath = newPath;
                Fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
                Editor.log('[' + PKG + '] UTCP config path: ' + newPath);
            } catch (e) { Editor.error(e); }
            this.updateMcpCodeBlock();
            this.fetchBridgeList();
        },

        updatePort() {
            const val = this.$.portInput && this.$.portInput.value;
            const port = parseInt(val);
            Editor.Ipc.sendToMain(PKG + ':restart-server', port, function (err) {
                if (err) Editor.error(err);
            });
        },

        updateMcpCodeBlock() {
            const el = this.$.mcpConfigCode;
            if (!el) return;
            const configPath = getConfigPath();
            el.textContent = JSON.stringify({
                mcpServers: {
                    "code-mode": {
                        command: "npx",
                        args: ["-y", "@utcp/code-mode-mcp"],
                        env: { UTCP_CONFIG_FILE: configPath }
                    }
                }
            }, null, 2);
        },

        fetchBridgeList() {
            const container = this.$.bridgeList;
            if (!container) return;
            container.innerHTML = '';
            const cfg = readUtcpConfig();
            const templates = cfg.manual_call_templates || [];
            if (templates.length === 0) {
                container.innerHTML = '<div style="padding:10px; color:#888;">No templates found.</div>';
                return;
            }
            let html = '';
            templates.forEach(function (t) {
                const isCocos = t.name === 'cc2x4' || t.name === 'cc24' || t.name === 'CocosEditor' || t.name === 'CocosEditor2x';
                const delBtn = isCocos ? '' : '<ui-button slot="header" type="danger" class="remove-btn" tooltip="Remove"><ui-icon value="del"></ui-icon></ui-button>';
                html += '<ui-section class="bridge-item-section" data-name="' + t.name + '">'
                    + '<div slot="header" style="display:flex;justify-content:space-between;align-items:center;width:100%;padding-right:10px;">'
                    + '<ui-label>' + t.name + ' (' + t.call_template_type + ')</ui-label>' + delBtn + '</div>'
                    + '<div class="bridge-item-content"><ui-code language="json" readonly id="code-' + t.name + '"></ui-code></div>'
                    + '</ui-section>';
            });
            container.innerHTML = html;
            templates.forEach(function (t) {
                const el = container.querySelector('#code-' + t.name);
                if (el) el.textContent = JSON.stringify(t, null, 2);
            });
        },

        addBridgeTemplate() {
            const input = this.$.newTemplateJson;
            if (!input) return;
            const content = input.value.trim();
            if (!content) return;
            try {
                const tpl = JSON.parse(content);
                if (!tpl.name || !tpl.call_template_type) { alert('Must have name and call_template_type.'); return; }
                const cfg = readUtcpConfig();
                cfg.manual_call_templates = cfg.manual_call_templates || [];
                if (cfg.manual_call_templates.find(function (t) { return t.name === tpl.name; })) { alert('Template ' + tpl.name + ' exists.'); return; }
                cfg.manual_call_templates.push(tpl);
                writeUtcpConfig(cfg);
                input.value = '';
                this.fetchBridgeList();
            } catch (e) { alert('Invalid JSON: ' + e.message); }
        },

        removeBridge(name) {
            if (name === 'cc2x4' || name === 'cc24' || name === 'CocosEditor' || name === 'CocosEditor2x') return;
            if (!confirm('Remove ' + name + '?')) return;
            const cfg = readUtcpConfig();
            cfg.manual_call_templates = (cfg.manual_call_templates || []).filter(function (t) { return t.name !== name; });
            writeUtcpConfig(cfg);
            this.fetchBridgeList();
        },
    },

    ready() {
        this.loadSettings();
        const self = this;
        if (this.$.savePortBtn) this.$.savePortBtn.addEventListener('click', function () { self.updatePort(); });
        if (this.$.utcpConfigPathSaveBtn) this.$.utcpConfigPathSaveBtn.addEventListener('click', function () { self.saveSettings(); });
        if (this.$.addBridgeBtn) this.$.addBridgeBtn.addEventListener('click', function () { self.addBridgeTemplate(); });
        if (this.$.bridgeList) this.$.bridgeList.addEventListener('click', function (e) {
            const btn = e.target.closest('.remove-btn');
            if (btn) {
                const section = btn.closest('.bridge-item-section');
                if (section && section.dataset.name) self.removeBridge(section.dataset.name);
            }
        });
    },

    beforeClose() {},
    close() {},
});
