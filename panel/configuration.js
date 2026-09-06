'use strict';

const Fs = require('fs');
const Path = require('path');
const Os = require('os');

const PKG = 'cc-bridge-2x';
const AGENT_INSTRUCTION =
    'CC Bridge controls Cocos Creator 2.4 through tools for scenes, nodes, components, inspector properties, assets, prefabs, animation, editor/project, and screenshots. Discover first, then act: inspect current state before mutations, retain returned references, and use batch operations where available.';
const COCOS_TEMPLATE = /^(ccb2x(_\d+)?|ccb3x(_\d+)?|cc-bridge-2x|cc-bridge-3x|ccb-2x|cc_bridge_2x|ccb_2x)$/;

function getConfigPath() {
    try {
        const profile = Editor.Profile.load('profile://project/' + PKG + '.json', { utcpConfigPath: '' });
        const v = profile.get('utcpConfigPath');
        if (v) return v;
    } catch (e) {}
    try {
        const projectPath = Editor.Project ? Editor.Project.path : null;
        if (projectPath) {
            const settingsPath = Path.join(projectPath, 'settings', PKG + '.json');
            if (Fs.existsSync(settingsPath)) {
                const data = JSON.parse(Fs.readFileSync(settingsPath, 'utf8'));
                if (data.utcpConfigPath) return data.utcpConfigPath;
            }
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
    Fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2));
}

function getServerPort() {
    try {
        const profile = Editor.Profile.load('profile://project/' + PKG + '.json', { serverPort: 0 });
        const v = profile.get('serverPort');
        if (typeof v === 'number' && v > 0) return v;
    } catch (e) {}
    try {
        const projectPath = Editor.Project ? Editor.Project.path : null;
        if (projectPath) {
            const settingsPath = Path.join(projectPath, 'settings', PKG + '.json');
            if (Fs.existsSync(settingsPath)) {
                const data = JSON.parse(Fs.readFileSync(settingsPath, 'utf8'));
                if (data.serverPort) return data.serverPort;
            }
        }
    } catch (e) {}
    return 0;
}

function el(panel, key, selector) {
    const named = panel['$' + key];
    if (named && typeof named.addEventListener === 'function') return named;
    const root = panel.shadowRoot || panel;
    if (root && typeof root.querySelector === 'function') return root.querySelector(selector);
    return null;
}

function copyText(text, label) {
    try {
        require('electron').clipboard.writeText(String(text || ''));
        Editor.log('[' + PKG + '] Copied ' + (label || 'text') + ' to clipboard');
    } catch (e) {
        Editor.warn('[' + PKG + '] Copy failed: ' + (e && e.message ? e.message : e));
    }
}

function utcpUrl(port) {
    return port ? 'http://localhost:' + port + '/utcp' : '';
}

function mcpConfigJson(configPath) {
    return JSON.stringify({
        mcpServers: {
            'cc-bridge': {
                command: 'npx',
                args: ['-y', '@utcp/code-mode-mcp'],
                env: { UTCP_CONFIG_FILE: configPath }
            }
        }
    }, null, 2);
}

Editor.Panel.extend({
    template: (function () {
        try {
            const t = Fs.readFileSync(Path.join(__dirname, '../static/template/configuration/index.html'), 'utf-8');
            if (t) return t;
        } catch (e) {}
        return '<div style="padding:20px;color:#f44">Template not found.</div>';
    })(),
    style: (function () {
        try {
            const s = Fs.readFileSync(Path.join(__dirname, '../static/style/configuration/index.css'), 'utf-8');
            if (s) return s;
        } catch (e) {}
        return '';
    })(),

    $: {
        portInput: '#port-input',
        savePortBtn: '#save-port-btn',
        copyPortBtn: '#copy-port-btn',
        utcpUrlInput: '#utcp-url',
        copyUrlBtn: '#copy-url-btn',
        mcpConfigCode: '#mcp-config-code',
        agentInstructionCode: '#agent-instruction-code',
        copyMcpBtn: '#copy-mcp-btn',
        copyInstructionBtn: '#copy-instruction-btn',
        utcpConfigPathInput: '#utcp-config-path',
        utcpConfigPathSaveBtn: '#save-utcp-path-btn',
        copyPathBtn: '#copy-path-btn',
        bridgeList: '#bridge-container',
        addBridgeBtn: '#add-bridge-btn',
        newTemplateJson: '#new-template-json',
    },

    loadSettings() {
        const self = this;
        const apply = function (port, configPath) {
            const portEl = el(self, 'portInput', '#port-input');
            const pathEl = el(self, 'utcpConfigPathInput', '#utcp-config-path');
            const urlEl = el(self, 'utcpUrlInput', '#utcp-url');
            if (portEl) portEl.value = port || 0;
            if (pathEl) pathEl.value = configPath || getConfigPath();
            if (urlEl) urlEl.value = utcpUrl(port);
            self.updateMcpCodeBlock();
            self.fetchBridgeList();
            self.fillInstruction();
        };
        apply(getServerPort(), getConfigPath());
        Editor.Ipc.sendToMain(PKG + ':query-status', function (err, data) {
            if (err || !data) return;
            apply(data.port, data.configPath);
        });
    },

    saveSettings() {
        const pathEl = el(this, 'utcpConfigPathInput', '#utcp-config-path');
        const newPath = pathEl && pathEl.value;
        if (!newPath) return;
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
        const portEl = el(this, 'portInput', '#port-input');
        const port = parseInt(portEl && portEl.value, 10);
        Editor.Ipc.sendToMain(PKG + ':restart-server', port, function (err) {
            if (err) Editor.error(err);
        });
    },

    updateMcpCodeBlock() {
        const codeEl = el(this, 'mcpConfigCode', '#mcp-config-code');
        if (!codeEl) return;
        codeEl.value = mcpConfigJson(getConfigPath());
    },

    fillInstruction() {
        const instEl = el(this, 'agentInstructionCode', '#agent-instruction-code');
        if (instEl) instEl.value = AGENT_INSTRUCTION;
    },

    fetchBridgeList() {
        const container = el(this, 'bridgeList', '#bridge-container');
        if (!container) return;
        container.innerHTML = '';
        const templates = readUtcpConfig().manual_call_templates || [];
        if (templates.length === 0) {
            container.innerHTML = '<div style="padding:10px;color:#888;">No templates found.</div>';
            return;
        }
        let html = '';
        templates.forEach(function (t) {
            const delBtn = COCOS_TEMPLATE.test(t.name)
                ? ''
                : '<ui-button class="tiny red remove-btn">Remove</ui-button>';
            const url = t.url ? String(t.url) : '';
            html += '<div class="bridge-item-section" data-name="' + t.name + '" data-url="' + url.replace(/"/g, '&quot;') + '">'
                + '<div class="bridge-item-header"><span>' + t.name + ' (' + t.call_template_type + ')</span>'
                + '<div class="bridge-item-actions">'
                + '<ui-button class="tiny copy-json-btn">Copy JSON</ui-button>'
                + (url ? '<ui-button class="tiny copy-tpl-url-btn">Copy URL</ui-button>' : '')
                + delBtn
                + '</div></div>'
                + '<ui-text-area readonly id="code-' + t.name + '"></ui-text-area>'
                + '</div>';
        });
        container.innerHTML = html;
        templates.forEach(function (t) {
            const codeEl = container.querySelector('#code-' + t.name);
            if (codeEl) codeEl.value = JSON.stringify(t, null, 2);
        });
    },

    addBridgeTemplate() {
        const input = el(this, 'newTemplateJson', '#new-template-json');
        if (!input) return;
        const content = String(input.value || '').trim();
        if (!content) return;
        try {
            const tpl = JSON.parse(content);
            if (!tpl.name || !tpl.call_template_type) { Editor.warn('Must have name and call_template_type.'); return; }
            const cfg = readUtcpConfig();
            cfg.manual_call_templates = cfg.manual_call_templates || [];
            if (cfg.manual_call_templates.find(function (t) { return t.name === tpl.name; })) {
                Editor.warn('Template ' + tpl.name + ' exists.');
                return;
            }
            cfg.manual_call_templates.push(tpl);
            writeUtcpConfig(cfg);
            input.value = '';
            this.fetchBridgeList();
        } catch (e) { Editor.error('Invalid JSON: ' + e.message); }
    },

    removeBridge(name) {
        if (COCOS_TEMPLATE.test(name)) return;
        const cfg = readUtcpConfig();
        cfg.manual_call_templates = (cfg.manual_call_templates || []).filter(function (t) { return t.name !== name; });
        writeUtcpConfig(cfg);
        this.fetchBridgeList();
    },

    ready() {
        const self = this;
        this.loadSettings();
        const on = function (key, selector, fn) {
            const node = el(self, key, selector);
            if (!node) return;
            node.addEventListener('confirm', fn);
            node.addEventListener('click', fn);
        };
        on('savePortBtn', '#save-port-btn', function () { self.updatePort(); });
        on('utcpConfigPathSaveBtn', '#save-utcp-path-btn', function () { self.saveSettings(); });
        on('addBridgeBtn', '#add-bridge-btn', function () { self.addBridgeTemplate(); });
        on('copyPortBtn', '#copy-port-btn', function () {
            const portEl = el(self, 'portInput', '#port-input');
            copyText(String((portEl && portEl.value) || ''), 'port');
        });
        on('copyUrlBtn', '#copy-url-btn', function () {
            const urlEl = el(self, 'utcpUrlInput', '#utcp-url');
            const portEl = el(self, 'portInput', '#port-input');
            copyText((urlEl && urlEl.value) || utcpUrl(portEl && portEl.value), 'UTCP URL');
        });
        on('copyPathBtn', '#copy-path-btn', function () {
            const pathEl = el(self, 'utcpConfigPathInput', '#utcp-config-path');
            copyText((pathEl && pathEl.value) || getConfigPath(), 'config path');
        });
        on('copyMcpBtn', '#copy-mcp-btn', function () { copyText(mcpConfigJson(getConfigPath()), 'MCP config'); });
        on('copyInstructionBtn', '#copy-instruction-btn', function () { copyText(AGENT_INSTRUCTION, 'AI instruction'); });
        const list = el(this, 'bridgeList', '#bridge-container');
        if (list) {
            list.addEventListener('click', function (e) {
                const target = e.target.closest ? e.target : null;
                if (!target || !target.closest) return;
                const section = target.closest('.bridge-item-section');
                if (!section) return;
                if (target.closest('.copy-json-btn')) {
                    const codeEl = section.querySelector('ui-text-area');
                    copyText(codeEl && codeEl.value, 'template JSON');
                    return;
                }
                if (target.closest('.copy-tpl-url-btn')) {
                    copyText(section.dataset.url || '', 'template URL');
                    return;
                }
                if (target.closest('.remove-btn') && section.dataset.name) {
                    self.removeBridge(section.dataset.name);
                }
            });
        }
    },

    beforeClose() {},
    close() {},
});
