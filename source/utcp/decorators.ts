import { HttpCallTemplate } from '@utcp/http';
import { JsonSchema, Tool } from '@utcp/sdk';
import { inferAnnotations, registerToolProfile } from './tool-profiles';

export interface ToolMetadata {
    method: Function;
    target: any;
    tool: Tool;
}

export class ToolRegistry {
    private static tools: Map<string, ToolMetadata> = new Map();

    static register(options: ToolMetadata) {
        this.tools.set(options.tool.name, options);
    }

    static getTools() {
        return Array.from(this.tools.values());
    }
}

export function utcpTool(name: string, description: string, inputs: JsonSchema, outputs: JsonSchema, httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', tags: string[] = [], options: { profile?: 'core' | 'full' } = {}) {
    return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
        if (!descriptor) return;

        ToolRegistry.register({
            method: descriptor.value,
            target,
            tool: {
                name,
                description,
                inputs,
                outputs,
                tags,
                tool_call_template: {
                    call_template_type: "http",
                    http_method: httpMethod,
                    request_body_format: "json",
                    url: `/tools/${name}`,
                    content_type: "application/json"
                } as HttpCallTemplate,
            }
        });

        // Register profile metadata separately (keeps UTCP manual strict-schema compliant)
        const annotations = inferAnnotations(name, httpMethod);
        registerToolProfile(name, {
            profile: options.profile || 'full',
            annotations,
        });
    };
}
