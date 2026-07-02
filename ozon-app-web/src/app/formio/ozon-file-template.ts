/**
 * Bootstrap Italia v2 markup for the Form.io `file` component (replaces the default
 * dropzone table). Keeps the Form.io `ref=` hooks so attach() wires upload/remove/restore:
 *   fileDrop, fileBrowse, fileProcessingLoader, fileLink, removeLink, restoreFile, progress.
 * Form.io accepts a template `form` as a function returning an HTML string (its compiled
 * .ejs default export is exactly that), so no template-string compilation is needed.
 */

const BI_SPRITE = 'bootstrap-italia/dist/svg/sprites.svg';

function biIcon(id: string, extra = ''): string {
    return `<svg class="icon icon-sm ${extra}" aria-hidden="true"><use href="${BI_SPRITE}#${id}"></use></svg>`;
}

function esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"]/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
    ));
}

function fileName(file: any): string {
    return esc(file?.originalName || file?.name || file?.filename);
}

function encodePath(path: string): string {
    return path.split('/').map((segment, index) => {
        if (index === 0) return '';
        return encodeURIComponent(decodeURIComponent(segment));
    }).join('/');
}

function fileUrl(file: any): string {
    const raw = String(file?.url ?? '').trim();
    if (!raw) return '#';
    if (raw.startsWith('data:') || /^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/api/client/attachment/')) return encodePath(raw);
    if (raw.startsWith('/client/attachment/')) return encodePath(raw);
    return encodePath(`/client/attachment/${raw.replace(/^\/+/, '')}`);
}

export function ozonFileTemplate(ctx: any): string {
    const t = (s: string): string => (typeof ctx?.t === 'function' ? ctx.t(s) : s);
    const fileSize = (s: unknown): string => (typeof ctx?.fileSize === 'function' ? ctx.fileSize(s) : '');
    const files: any[] = Array.isArray(ctx?.files) ? ctx.files : [];
    const filesToUpload: any[] = Array.isArray(ctx?.filesToUpload) ? ctx.filesToUpload : [];
    const filesToDelete: any[] = Array.isArray(ctx?.filesToDelete) ? ctx.filesToDelete : [];
    const disabled = !!ctx?.disabled;
    const multiple = !!ctx?.component?.multiple;

    let html = '<div class="ozon-file">';

    html += '<ul class="upload-file-list">';

    // Saved files: download link + delete button.
    for (const file of files) {
        const name = fileName(file);
        html += `<li class="upload-file success">`;
        html += biIcon('it-file');
        // No `ref="fileLink"`: Form.io hijacks that click with its own getFile().
        // The renderer normalizes backend file urls to the authenticated API/proxy endpoint.
        html += `<a href="${esc(fileUrl(file))}" target="_blank" class="ozon-file-download" `
            + `data-file-url="${esc(file?.url || '')}" data-file-name="${esc(file?.filename || file?.originalName || file?.name)}">`
            + `<span class="visually-hidden">${t('Scarica')} </span>${name}</a>`;
        if (file?.size != null) html += `<span class="upload-file-weight">${esc(fileSize(file.size))}</span>`;
        if (!disabled) {
            html += `<button type="button" class="ozon-file-remove" ref="removeLink" `
                + `aria-label="${t('Elimina')} ${name}">${biIcon('it-delete', 'icon-danger')}</button>`;
        }
        html += '</li>';
    }

    // Files being uploaded (progress / status).
    for (const file of filesToUpload) {
        const name = fileName(file);
        const status = file?.status === 'error' ? 'danger' : esc(file?.status);
        html += `<li class="upload-file uploading">`;
        html += biIcon('it-file');
        html += `<span>${name}</span>`;
        if (file?.status === 'progress') {
            html += `<span class="progress"><span id="${esc(file?.id)}" class="progress-bar" `
                + `role="progressbar" style="width:${esc(file?.progress)}%" ref="progress"></span></span>`;
        } else {
            html += `<span class="status text-${status}">${esc(t(file?.message || ''))}</span>`;
        }
        html += '</li>';
    }

    // Files marked for deletion: offer restore.
    for (const file of filesToDelete) {
        const name = fileName(file);
        html += `<li class="upload-file"><span>${name}</span>`
            + `<button type="button" class="ozon-file-remove" ref="restoreFile" `
            + `aria-label="${t('Ripristina')} ${name}">${biIcon('it-refresh')}</button></li>`;
    }

    html += '</ul>';

    // Upload area — kept visible while `multiple` (or no files yet) so files can be added in any phase.
    if (!disabled && (multiple || files.length === 0)) {
        html += `<div class="fileSelector ozon-file-drop" ref="fileDrop">`
            + `<a href="#" ref="fileBrowse" class="ozon-file-browse">`
            + biIcon('it-upload')
            + `<span>${t('Trascina i file qui o sfoglia')}</span>`
            + `</a>`
            + `<div ref="fileProcessingLoader" class="loader-wrapper"><div class="loader text-center"></div></div>`
            + `</div>`;
    }

    html += '</div>';
    return html;
}
