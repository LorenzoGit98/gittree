/**
 * Type declarations for renderer classic-script globals (ADR-0008).
 * Before the ESM switch (M6a), renderer modules expose globals via script
 * tags; these declarations let checkJs verify their consumers against the
 * real module shapes instead of implicit any.
 */

declare const ToastService: typeof import('./toast-service');
declare const EventBus: typeof import('./event-bus');
declare const DialogService: typeof import('./dialog-service');
declare const HtmlEncoder: typeof import('./html-encoder');
declare const I18n: typeof import('./i18n');
declare const Theme: typeof import('./theme');
