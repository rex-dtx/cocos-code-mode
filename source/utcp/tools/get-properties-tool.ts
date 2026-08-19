import { utcpTool } from '../decorators';
import { IInstanceReference, InstanceReferenceSchema } from '../schemas';
import { ToolsUtils } from '../utils/tools-utils';

export class GetPropertiesTool {

    /** @deprecated use inspectorGet({ target: 'CurrentSceneGlobals'|'ProjectSettings' }) */
    @utcpTool(
        "inspectorGetSettingsProperties",
        "[DEPRECATED] Use inspectorGet. Gets plain object of properties for the specific settings.",
        { type: 'object', properties: { settingsType: { type: 'string', enum: ['CurrentSceneGlobals', 'ProjectSettings'] } }, required: ['settingsType'] },
        { type: 'object', properties: { dump: { type: 'object' } }, required: ['dump'] }, "GET",  ['inspect', 'scene', 'properties', 'settings', 'config', 'dump']
    )
    async inspectorGetSettingsProperties(params: { settingsType: string }): Promise<any> {
        return await this.inspectorGetProperties({ reference: { id: params.settingsType } });
    }

    /** @deprecated use inspectorGet({ target: 'instance', reference }) */
    @utcpTool(
        "inspectorGetInstanceProperties",
        "[DEPRECATED] Use inspectorGet. Get properties for instance. Use fields[] for specific keys.",
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                fields: { type: 'array', items: { type: 'string' }, description: 'Optional: only return these top-level property keys. Omit for full dump.' }
            },
            required: ['reference']
        },
        { type: 'object', properties: { dump: { type: 'object' } }, required: ['dump'] }, "GET",  ['inspect', 'properties', 'dump', 'instance', 'node', 'component', 'asset', 'data']
    )
    async inspectorGetProperties(args: { reference: IInstanceReference, fields?: string[] }): Promise<{ dump: any }> {
        const info = await ToolsUtils.inspectInstance(args.reference.id);
        if (!info) {
            throw new Error(`Target ${args.reference.id} not found or not supported.`);
        }

        const { props, type, assetInfo } = info;
        if (!props) {
            throw new Error(`Could not retrieve properties for ${type} (${args.reference.id}).`);
        }

        // ponytail: selective unwrap — when fields specified, filter raw props BEFORE
        // unwrapping so we skip expensive recursive unwrap on unwanted subtrees.
        let filteredProps = props;
        if (args.fields && args.fields.length > 0) {
            filteredProps = {};
            for (const key of args.fields) {
                if (key in props) {
                    filteredProps[key] = props[key];
                }
            }
        }

        const parsedProps = ToolsUtils.unwrapProperties(filteredProps);

        return { dump: parsedProps };
    }
}

