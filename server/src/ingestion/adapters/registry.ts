import type { ConnectorAdapter } from "../types.js";
import { genericSecurityEventsAdapter } from "./genericSecurityEvents.js";
import {
  SAMPLE_WORKBOOK_ADAPTER_KEY,
  sampleWorkbookAdapter,
} from "./sampleWorkbook.js";

const adapters: Record<string, ConnectorAdapter> = {
  [genericSecurityEventsAdapter.adapterKey]: genericSecurityEventsAdapter,
  // Alias used in UI/docs
  generic: genericSecurityEventsAdapter,
  [SAMPLE_WORKBOOK_ADAPTER_KEY]: sampleWorkbookAdapter,
};

export function getAdapter(adapterKey: string): ConnectorAdapter | null {
  return adapters[adapterKey] ?? null;
}

export function listAdapterKeys(): string[] {
  return Object.keys(adapters);
}
