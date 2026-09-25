import {
    CreatorDialogSignal,
    EditorPopupInspectResult,
    PopupClassification,
    PopupWindowObservation,
    PopupWindowRecord,
} from './editor-popup-contracts';

const SOURCE_ORDER: Record<string, number> = { electron: 0, 'desktop-capturer': 1, native: 2 };
const CLASSIFICATION_ORDER: Record<PopupClassification, number> = {
    'creator-main': 0,
    devtools: 1,
    worker: 2,
    dialog: 3,
    panel: 4,
    unknown: 5,
};

function boundedText(value: unknown, maximum: number): string {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function boundedId(value: unknown): string {
    return boundedText(value, 128);
}

function normalizeSignals(signals: unknown): string[] {
    if (!Array.isArray(signals)) return [];
    return [...new Set(signals.filter((signal): signal is string => typeof signal === 'string' && signal.length > 0).map(signal => signal.slice(0, 128)))]
        .sort((a, b) => a.localeCompare(b));
}

function normalizeBounds(value: PopupWindowObservation['bounds']): PopupWindowObservation['bounds'] {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.width) || !Number.isFinite(value.height)) return null;
    return {
        x: Math.round(value.x),
        y: Math.round(value.y),
        width: Math.max(0, Math.round(value.width)),
        height: Math.max(0, Math.round(value.height)),
    };
}

function classify(observation: PopupWindowObservation): PopupWindowRecord {
    const evidence = observation.classificationEvidence;
    let classification: PopupClassification;
    if (evidence.creatorMain) classification = 'creator-main';
    else if (evidence.devtools) classification = 'devtools';
    else if (evidence.worker) classification = 'worker';
    else if (observation.modal === true || (observation.ownerVerified && observation.parentId !== null)) classification = 'dialog';
    else if (observation.source === 'native' && observation.ownerVerified) classification = 'dialog';
    else if (observation.visible || observation.source === 'electron') classification = 'panel';
    else classification = 'unknown';

    const signals = normalizeSignals(observation.signals);
    if (classification === 'creator-main' && !signals.includes('creator-main')) signals.push('creator-main');
    if (classification === 'dialog' && observation.modal === true && !signals.includes('modal')) signals.push('modal');
    if (classification === 'dialog' && observation.ownerVerified && !signals.includes('creator-owner')) signals.push('creator-owner');
    signals.sort((a, b) => a.localeCompare(b));

    return {
        source: observation.source,
        id: boundedId(observation.id),
        title: boundedText(observation.title, 256),
        visible: observation.visible === true,
        focused: observation.focused === null ? null : observation.focused === true,
        modal: observation.modal === null ? null : observation.modal === true,
        parentId: observation.parentId === null ? null : boundedId(observation.parentId),
        ownerVerified: observation.ownerVerified === true,
        bounds: normalizeBounds(observation.bounds),
        classification,
        signals,
        content: observation.content ?? { text: null, source: null, truncated: false },
        actions: Array.isArray(observation.actions) ? observation.actions.slice(0, 16) : [],
    };
}

function compareRecords(left: PopupWindowRecord, right: PopupWindowRecord): number {
    const source = (SOURCE_ORDER[left.source] ?? 99) - (SOURCE_ORDER[right.source] ?? 99);
    if (source !== 0) return source;
    const leftId = left.id.replace(/^[^:]+:/, '');
    const rightId = right.id.replace(/^[^:]+:/, '');
    const leftNumber = Number(leftId);
    const rightNumber = Number(rightId);
    if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber;
    const id = left.id.localeCompare(right.id);
    if (id !== 0) return id;
    const classification = CLASSIFICATION_ORDER[left.classification] - CLASSIFICATION_ORDER[right.classification];
    if (classification !== 0) return classification;
    return left.title.localeCompare(right.title);
}

function isActionableDialog(record: PopupWindowRecord): boolean {
    return record.visible && record.classification === 'dialog' && (record.modal === true || record.ownerVerified);
}

function isCandidate(record: PopupWindowRecord): boolean {
    if (!record.visible || record.classification === 'creator-main' || record.classification === 'devtools' || record.classification === 'worker') return false;
    return record.classification === 'dialog' || record.classification === 'unknown' || record.classification === 'panel';
}

export interface PopupClassificationOptions {
    maxItems: number;
    complete: boolean;
    unavailable: EditorPopupInspectResult['unavailable'];
    raceDetected?: boolean;
}

export function classifyPopupWindows(
    creatorDialog: CreatorDialogSignal,
    observations: PopupWindowObservation[],
    options: PopupClassificationOptions,
): EditorPopupInspectResult {
    const records = observations.map(classify).sort(compareRecords);
    const total = records.length;
    const windows = records.slice(0, options.maxItems);
    const truncated = total > options.maxItems;
    const unavailable = [...new Set(options.unavailable)].sort((a, b) => a.localeCompare(b)) as EditorPopupInspectResult['unavailable'];
    const actionable = records.some(isActionableDialog);
    const detected = creatorDialog.open === true || actionable;
    const candidate = records.some(isCandidate);
    const blocking = creatorDialog.open === true || actionable
        ? true
        : !options.complete || creatorDialog.open === null || candidate
            ? null
            : false;

    return {
        capturedAt: Date.now(),
        detected,
        blocking,
        raceDetected: options.raceDetected === true,
        creatorDialog,
        windows,
        total,
        truncated,
        complete: options.complete,
        unavailable,
    };
}
