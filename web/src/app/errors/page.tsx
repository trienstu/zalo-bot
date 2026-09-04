import { dbExists, listBotErrors, listSchemaMigrations } from "@/lib/db";
import { LogViewer } from "./log-viewer";

export const dynamic = "force-dynamic";

export default function ErrorsPage() {
  const hasDb = dbExists();
  const errors = hasDb ? listBotErrors(200) : [];
  const migrations = hasDb ? listSchemaMigrations(20) : [];

  return (
    <div className="py-2">
      <LogViewer
        initialDbErrors={errors}
        initialMigrations={migrations}
      />
    </div>
  );
}

