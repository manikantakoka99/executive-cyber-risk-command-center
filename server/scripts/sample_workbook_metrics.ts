import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "../../.env") });

import { query } from "../src/db.js";
import {
  resetSampleWorkbookIngestion,
  runSampleWorkbookIngestion,
  getSampleWorkbookResults,
} from "../src/services/sampleWorkbookIngestion.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";

async function main() {
  await resetSampleWorkbookIngestion(AL);
  const first = await runSampleWorkbookIngestion(AL, { correlate: true });
  const second = await runSampleWorkbookIngestion(AL, { correlate: false });
  const res = await getSampleWorkbookResults(AL);
  const kinds = await query<{ signal_kind: string; n: string }>(
    `SELECT signal_kind::text, COUNT(*)::text AS n FROM security_signals s
     JOIN connectors c ON c.connector_id=s.connector_id
     WHERE s.org_id=$1 AND c.adapter_key='ecc.sample_workbook' AND s.is_duplicate=false
     GROUP BY 1 ORDER BY 1`,
    [AL],
  );
  const patterns = await query<{ p: string; n: string }>(
    `SELECT source_metadata->>'ingestionPattern' AS p, COUNT(*)::text AS n
     FROM raw_events WHERE org_id=$1 AND connector_id=$2 GROUP BY 1 ORDER BY 1`,
    [AL, first.connectorId],
  );
  console.log(
    JSON.stringify(
      {
        first: first.result,
        second: {
          duplicateCount: second.result.duplicateCount,
          acceptedCount: second.result.acceptedCount,
        },
        kinds: kinds.rows,
        patterns: patterns.rows,
        domainBuckets: res.byDomain.length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
