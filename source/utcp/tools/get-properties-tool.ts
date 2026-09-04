import { IInstanceReference, InstanceReferenceSchema } from '../schemas';
import { ToolsUtils } from '../utils/tools-utils';

export class GetPropertiesTool {

    /** @deprecated use inspectorGet({ target: 'CurrentSceneGlobals'|'ProjectSettings' }) — not registered, kept for delegation */
    async inspectorGetSettingsProperties(params: { settingsType: string }): Promise<any> {
        return await this.inspectorGetProperties({ reference: { id: params.settingsType } });
    }

    /** @deprecated use inspectorGet({ target: 'instance', reference }) — not registered, kept for delegation */
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
            // A typo'd field used to vanish silently — indistinguishable from "the
            // target has no such property". Name the offenders instead.
            const unknown = args.fields.filter((key) => !(key in props));
            if (unknown.length > 0) {
                throw new Error(`inspectorGet: fields not present on ${type} (${args.reference.id}): ${unknown.join(', ')}`);
            }
            for (const key of args.fields) {
                filteredProps[key] = props[key];
            }
        }

        const parsedProps = ToolsUtils.unwrapProperties(filteredProps);

        return { dump: parsedProps };
    }

}
