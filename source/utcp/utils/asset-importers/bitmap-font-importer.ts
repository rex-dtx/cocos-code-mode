import { BaseAssetImporter } from './base-importer';
import { IAssetInfo } from '@cocos/creator-types/editor/packages/asset-db/@types/public';
import { IPropertyValueType } from '@cocos/creator-types/editor/packages/scene/@types/public';

// Creator 3.7.3 publishes the bitmap-font importer fields under the asset meta userData, but
// every one of them is derived: the importer parses the .fnt file into `_fntConfig`, writes
// `fontSize` from that parsed config and emits `textureUuid` for the atlas it generated.
// Writing `fontSize` through save-asset-meta can change the current meta snapshot, but it is not an importer setting: a later source reparse overwrites it from the .fnt file (live on 3.7.3: file size 77 -> meta 77, meta write 999 -> 999 temporarily, file size 88 -> meta 88). The honest contract is a typed, read-only audit and setProperty refuses every path.
export class BitmapFontImporter extends BaseAssetImporter {
    name = 'bitmap-font';

    async getProperties(assetInfo: IAssetInfo): Promise<{ [key: string]: IPropertyValueType }> {
        const meta = await Editor.Message.request('asset-db', 'query-asset-meta', assetInfo.uuid);
        const userData = meta?.userData;
        if (!userData) throw new Error(`Bitmap font import settings are unavailable for asset ${assetInfo.uuid}.`);

        const fontSize = userData.fontSize;
        const textureUuid = userData.textureUuid;
        const fntConfig = userData._fntConfig;

        return {
            fontSize: {
                value: Number.isInteger(fontSize) ? fontSize : 0,
                type: 'Integer',
                displayName: 'Font Size',
                readonly: true,
            },
            textureUuid: {
                value: typeof textureUuid === 'string' ? textureUuid : '',
                type: 'String',
                displayName: 'Atlas Texture',
                readonly: true,
            },
            glyphCount: {
                value: fntConfig && typeof fntConfig === 'object' && fntConfig.fontDefDictionary
                    ? Object.keys(fntConfig.fontDefDictionary).length
                    : 0,
                type: 'Integer',
                displayName: 'Rasterised Glyphs',
                readonly: true,
            },
        };
    }

    async setProperty(_assetInfo: IAssetInfo, _path: string, _value: unknown): Promise<boolean> {
        // Nothing to write: every bitmap-font field is derived from the .fnt source, and
        // assetImportSettingsSet already refuses these paths as read-only from the schema,
        // so this refusal is the belt-and-braces path for a direct call.
        return false;
    }
}
