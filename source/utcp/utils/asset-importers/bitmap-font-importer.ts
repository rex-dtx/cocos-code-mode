import { BaseAssetImporter } from './base-importer';
import { IAssetInfo } from '@cocos/creator-types/editor/packages/asset-db/@types/public';
import { IPropertyValueType } from '@cocos/creator-types/editor/packages/scene/@types/public';

// Creator 3.7.3 publishes the bitmap-font importer settings under the asset meta userData:
// `fontSize` (integer, drives the glyph rasterisation), `textureUuid` (the atlas the importer
// emitted, read-only from the bridge's perspective) and `_fntConfig` (the parsed .fnt
// dictionary, which the importer owns and recomputes on reimport). Only the first is a
// settable contract, so the other two are surfaced read-only instead of as silent no-ops.
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

    async setProperty(assetInfo: IAssetInfo, path: string, value: unknown): Promise<boolean> {
        // The importer derives the atlas and the glyph dictionary on reimport; only the
        // rasterisation size is an input, so every other path is a typed refusal.
        if (path !== 'fontSize') return false;
        if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 512) return false;

        const meta = await Editor.Message.request('asset-db', 'query-asset-meta', assetInfo.uuid);
        if (!meta || typeof meta !== 'object' || !meta.userData) return false;

        meta.userData = { ...meta.userData, fontSize: value };
        await Editor.Message.request('asset-db', 'save-asset-meta', assetInfo.uuid, JSON.stringify(meta));
        return true;
    }
}
