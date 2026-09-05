import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { getDeckNames, getModelFieldNames, getModelNames, getVersion } from "../lib/anki";
import {
  CARD_SOURCES,
  SOURCE_LABELS,
  loadAnkiSettings,
  saveAnkiSettings,
  type AnkiSettings,
  type CardSource,
} from "../lib/ankiSettings";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

type Connection = {
  status: "idle" | "testing" | "ok" | "error";
  message: string | null;
};

function SettingsPage() {
  const [url, setUrl] = useState(loadAnkiSettings().url);
  const [connection, setConnection] = useState<Connection>({ status: "idle", message: null });

  const [decks, setDecks] = useState<string[]>([]);
  const [deck, setDeck] = useState("");
  const [noteTypes, setNoteTypes] = useState<string[]>([]);
  const [noteType, setNoteType] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [mappings, setMappings] = useState<Record<string, CardSource>>({});
  const [justSaved, setJustSaved] = useState(false);

  // Ref so connect() reads latest state without re-creating on each keystroke.
  const stateRef = useRef({ url, deck, noteType, mappings });
  stateRef.current = { url, deck, noteType, mappings };

  useEffect(() => {
    const saved = loadAnkiSettings();
    void connect(saved.url, saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Test the connection; pass `saved` to restore a previous selection. */
  async function connect(targetUrl: string, saved: AnkiSettings | null) {
    setConnection({ status: "testing", message: null });
    try {
      const version = await getVersion(targetUrl);
      const [fetchedDecks, fetchedNoteTypes] = await Promise.all([
        getDeckNames(targetUrl),
        getModelNames(targetUrl),
      ]);
      setDecks(fetchedDecks);
      setNoteTypes(fetchedNoteTypes);
      setConnection({ status: "ok", message: `Connected — AnkiConnect v${version}` });

      if (saved) {
        const restoredDeck = saved.deck && fetchedDecks.includes(saved.deck) ? saved.deck : "";
        const restoredNoteType =
          restoredDeck && saved.noteType && fetchedNoteTypes.includes(saved.noteType)
            ? saved.noteType
            : "";
        setDeck(restoredDeck);
        setNoteType(restoredNoteType);
        if (restoredNoteType) {
          await loadFields(targetUrl, restoredNoteType, saved.mappings);
        }
      } else {
        // Manual re-test: keep selections that still exist.
        const {
          deck: currentDeck,
          noteType: currentNoteType,
          mappings: currentMappings,
        } = stateRef.current;
        if (currentDeck && !fetchedDecks.includes(currentDeck)) setDeck("");
        if (currentNoteType && fetchedNoteTypes.includes(currentNoteType)) {
          await loadFields(targetUrl, currentNoteType, currentMappings);
        } else {
          setNoteType("");
          setFields([]);
        }
      }
    } catch (err) {
      setConnection({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function loadFields(
    targetUrl: string,
    targetNoteType: string,
    keepMappings: Record<string, CardSource>,
  ) {
    setLoadingFields(true);
    try {
      const names = await getModelFieldNames(targetUrl, targetNoteType);
      setFields(names);
      // Keep only mappings whose field still exists.
      setMappings(
        Object.fromEntries(
          Object.entries(keepMappings).filter(
            ([field, source]) => names.includes(field) && CARD_SOURCES.includes(source),
          ),
        ),
      );
    } catch (err) {
      setConnection({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      setFields([]);
    } finally {
      setLoadingFields(false);
    }
  }

  function handleUrlChange(nextUrl: string) {
    setUrl(nextUrl);
    // Edits invalidate the connection; require an explicit re-test.
    setConnection({ status: "idle", message: null });
  }

  function handleDeckChange(nextDeck: string) {
    setDeck(nextDeck);
    setNoteType("");
    setFields([]);
    setMappings({});
  }

  function handleNoteTypeChange(nextNoteType: string) {
    setNoteType(nextNoteType);
    setFields([]);
    setMappings({});
    if (nextNoteType) void loadFields(stateRef.current.url, nextNoteType, {});
  }

  const connected = connection.status === "ok";
  const hasMapping = Object.keys(mappings).length > 0;
  const canSave = connected && deck !== "" && noteType !== "" && !loadingFields && hasMapping;

  function handleSave() {
    saveAnkiSettings({ url: stateRef.current.url, deck, noteType, mappings });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <section className="mt-6 space-y-6">
        <div>
          <h2 className="font-medium">Anki export</h2>
          <p className="mt-1 text-sm text-base-content/60">
            Export transcript lines as Anki cards via AnkiConnect. Requires Anki to be running with
            the AnkiConnect add-on.
          </p>
        </div>

        {/* 1. AnkiConnect URL */}
        <div className="space-y-2">
          <label className="label" htmlFor="anki-url">
            1. AnkiConnect URL
          </label>
          <div className="join w-full">
            <input
              id="anki-url"
              type="url"
              placeholder="http://127.0.0.1:8765"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="input join-item min-w-0 grow"
            />
            <button
              type="button"
              className="btn join-item"
              disabled={connection.status === "testing" || url.trim() === ""}
              onClick={() => void connect(url, null)}
            >
              {connection.status === "testing" && (
                <span className="loading loading-spinner loading-sm" />
              )}
              Test
            </button>
          </div>
          {connection.message && (
            <p className={`text-sm ${connected ? "text-success" : "text-error"}`}>
              {connection.message}
            </p>
          )}
        </div>

        {/* 2. Deck */}
        <div className="space-y-2">
          <label className="label" htmlFor="anki-deck">
            2. Deck
          </label>
          <select
            id="anki-deck"
            value={deck}
            onChange={(e) => handleDeckChange(e.target.value)}
            disabled={!connected}
            className="select w-full"
          >
            <option value="" disabled>
              {connected ? "Choose a deck…" : "Connect to Anki first"}
            </option>
            {decks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Note type */}
        <div className="space-y-2">
          <label className="label" htmlFor="anki-note-type">
            3. Note type
          </label>
          <select
            id="anki-note-type"
            value={noteType}
            onChange={(e) => handleNoteTypeChange(e.target.value)}
            disabled={!connected || deck === ""}
            className="select w-full"
          >
            <option value="" disabled>
              {deck === "" ? "Select a deck first" : "Choose a note type…"}
            </option>
            {noteTypes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* 4. Field mappings */}
        <div className="space-y-2">
          <h3 className="label">4. Map note fields</h3>
          {!noteType ? (
            <p className="text-sm text-base-content/60">Select a note type to map its fields.</p>
          ) : loadingFields ? (
            <p className="text-sm text-base-content/60">
              <span className="loading loading-spinner loading-xs mr-2" />
              Loading fields…
            </p>
          ) : fields.length === 0 ? (
            <p className="text-sm text-error">No fields found for this note type.</p>
          ) : (
            <div className="space-y-3">
              {fields.map((field) => (
                <div key={field} className="grid grid-cols-1 items-center gap-3 sm:grid-cols-2">
                  <span className="truncate text-sm">{field}</span>
                  <select
                    aria-label={`Data source for field ${field}`}
                    value={mappings[field] ?? ""}
                    onChange={(e) =>
                      setMappings((prev) => {
                        const next = { ...prev };
                        if (e.target.value === "") delete next[field];
                        else next[field] = e.target.value as CardSource;
                        return next;
                      })
                    }
                    className="select w-full"
                  >
                    <option value="">— None —</option>
                    {CARD_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {SOURCE_LABELS[source]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
          {justSaved ? "Saved ✓" : "Save settings"}
        </button>
        {connected && deck !== "" && noteType !== "" && !loadingFields && !hasMapping && (
          <p className="text-sm text-base-content/60">
            Map at least one field above to enable saving.
          </p>
        )}
      </section>
    </main>
  );
}
