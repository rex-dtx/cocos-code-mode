import { BaseAssetImporter } from './base-importer';
import { IAssetInfo } from '@cocos/creator-types/editor/packages/asset-db/@types/public';
import { IProperty, IPropertyValueType } from '@cocos/creator-types/editor/packages/scene/@types/public';

export class SceneImporter extends BaseAssetImporter {
    name = 'scene';

    async getProperties(assetInfo: IAssetInfo): Promise<{ [key: string]: IPropertyValueType }> {
        const meta = await Editor.Message.request('asset-db', 'query-asset-meta', assetInfo.uuid);
        return {
            uuid: { value: assetInfo.uuid, type: 'String', readonly: true },
            name: { value: assetInfo.name || '', type: 'String', readonly: true },
            url: { value: assetInfo.url || '', type: 'String', readonly: true },
            importer: { value: 'scene', type: 'String', readonly: true },
            imported: { value: meta?.imported ?? true, type: 'Boolean', readonly: true },
            asyncLoadAssets: { value: !!meta?.userData?.asyncLoadAssets, type: 'Boolean', displayName: 'Async Load Assets' }
        };
    }

    async setProperty(assetInfo: IAssetInfo, path: string, value: any): Promise<boolean> {
        const meta = await Editor.Message.request('asset-db', 'query-asset-meta', assetInfo.uuid);
        if (!meta) return false;
        if (!meta.userData) meta.userData = {};
        
        if (path === 'asyncLoadAssets') {
            meta.userData.asyncLoadAssets = !!value;
            await Editor.Message.request('asset-db', 'save-asset-meta', assetInfo.uuid, JSON.stringify(meta));
            return true;
        }
        return false;
    }
}
