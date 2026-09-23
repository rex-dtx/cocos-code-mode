import { JsonSchema } from '@utcp/sdk';

export const popupWindowSources = ['electron', 'desktop-capturer', 'native'] as const;
export type PopupWindowSource = typeof popupWindowSources[number];

export const popupClassifications = ['creator-main', 'dialog', 'panel', 'devtools', 'worker', 'unknown'] as const;
export type PopupClassification = typeof popupClassifications[number];

export const popupUnavailableAdapters = [
    'creator-dialog-ipc',
    'electron-browser-window',
    'electron-desktop-capturer',
    'windows-native',
] as const;
export type PopupUnavailableAdapter = typeof popupUnavailableAdapters[number];

export interface PopupBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface PopupActionRecord {
    id: string;
    label: string;
    enabled: boolean;
}

export interface EditorPopupActionArgs {
    operation: 'remind' | 'activate';
    popupId: string;
    popupTitle: string;
    actionId?: string;
    actionLabel?: string;
    confirm?: boolean;
    authorization?: 'user-explicit';
}

export interface EditorPopupActionResult {
    operation: 'remind' | 'activate';
    popupId: string;
    actionId: string | null;
    actionLabel: string | null;
    activated: boolean;
    closed: boolean;
    reminderId: string | null;
}

export interface EditorPopupInspectArgs {
    includeNative?: boolean;
    includeHidden?: boolean;
    maxItems?: number;
}

export interface CreatorDialogSignal {
    available: boolean;
    open: boolean | null;
    source: 'information/has-dialog' | null;
}

export interface PopupWindowRecord {
    source: PopupWindowSource;
    id: string;
    title: string;
    visible: boolean;
    focused: boolean | null;
    modal: boolean | null;
    parentId: string | null;
    ownerVerified: boolean;
    bounds: PopupBounds | null;
    classification: PopupClassification;
    signals: string[];
    actions: PopupActionRecord[];
}

export interface PopupWindowObservation extends Omit<PopupWindowRecord, 'classification'> {
    classificationEvidence: {
        creatorMain?: boolean;
        devtools?: boolean;
        worker?: boolean;
    };
}

export interface EditorPopupInspectResult {
    capturedAt: number;
    detected: boolean;
    blocking: boolean | null;
    raceDetected: boolean;
    creatorDialog: CreatorDialogSignal;
    windows: PopupWindowRecord[];
    total: number;
    truncated: boolean;
    complete: boolean;
    unavailable: PopupUnavailableAdapter[];
}

const object = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
});
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const text = (maxLength: number, minLength = 0): JsonSchema => ({ type: 'string', minLength, maxLength });
const integer = (minimum?: number): JsonSchema => ({ type: 'integer', ...(minimum === undefined ? {} : { minimum }) });
const boolean: JsonSchema = { type: 'boolean' };
const boundsSchema = object({ x: integer(), y: integer(), width: integer(0), height: integer(0) });
const creatorDialogSchema = object({
    available: boolean,
    open: nullable(boolean),
    source: nullable({ type: 'string', enum: ['information/has-dialog'] }),
});
const popupActionSchema = object({
    id: text(192, 1),
    label: text(256),
    enabled: boolean,
});

const popupWindowSchema = object({
    source: { type: 'string', enum: [...popupWindowSources] },
    id: text(128, 1),
    title: text(256),
    visible: boolean,
    focused: nullable(boolean),
    modal: nullable(boolean),
    parentId: nullable(text(128, 1)),
    ownerVerified: boolean,
    bounds: nullable(boundsSchema),
    classification: { type: 'string', enum: [...popupClassifications] },
    signals: { type: 'array', maxItems: 16, items: text(128) },
    actions: { type: 'array', maxItems: 16, items: popupActionSchema },
});

export const EditorPopupInspectInputSchema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        includeNative: { type: 'boolean', default: false, description: 'Request the optional native-window adapter. It is currently unavailable until live-gated.' },
        includeHidden: { type: 'boolean', default: false },
        maxItems: { type: 'integer', minimum: 1, maximum: 32, default: 16 },
    },
    required: [],
};

export const EditorPopupInspectOutputSchema: JsonSchema = object({
    capturedAt: { type: 'integer', minimum: 0 },
    detected: boolean,
    blocking: nullable(boolean),
    raceDetected: boolean,
    creatorDialog: creatorDialogSchema,
    windows: { type: 'array', maxItems: 32, items: popupWindowSchema },
    total: { type: 'integer', minimum: 0 },
    truncated: boolean,
    complete: boolean,
    unavailable: { type: 'array', maxItems: popupUnavailableAdapters.length, uniqueItems: true, items: { type: 'string', enum: [...popupUnavailableAdapters] } },
});


export const EditorPopupActionInputSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        operation: { type: 'string', enum: ['remind', 'activate'] },
        popupId: text(128, 1), popupTitle: text(256),
        actionId: text(192, 1), actionLabel: text(256), confirm: boolean,
        authorization: { type: 'string', enum: ['user-explicit'] },
    },
    required: ['operation', 'popupId', 'popupTitle'],
    allOf: [{ if: { properties: { operation: { const: 'activate' } }, required: ['operation'] }, then: { required: ['actionId', 'actionLabel', 'confirm', 'authorization'] } }],
};

export const EditorPopupActionOutputSchema: JsonSchema = object({
    operation: { type: 'string', enum: ['remind', 'activate'] },
    popupId: text(128, 1), actionId: nullable(text(192, 1)), actionLabel: nullable(text(256)),
    activated: boolean, closed: boolean, reminderId: nullable(text(64, 1)),
});