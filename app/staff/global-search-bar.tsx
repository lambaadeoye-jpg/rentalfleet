"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Users, ClipboardList } from "lucide-react";
import { globalSearch, type SearchResult } from "./search-actions";

const TYPE_ICON = { customer: User, lead: Users, application: ClipboardList };

export default function GlobalSearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const found = await globalSearch(query);
      setResults(found);
      setOpen(true);
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function handleSelect(result: SearchResult) {
    setOpen(false);
    setQuery("");
    router.push(result.href);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", marginBottom: 16, padding: "0 10px" }}>
      <div style={{ position: "relative" }}>
        <Search size={14} style={{ position: "absolute", left: 8, top: 9, color: "rgba(255,255,255,0.4)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search..."
          style={{
            width: "100%",
            paddingLeft: 28,
            fontSize: 13,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "white",
            borderRadius: 8,
            padding: "7px 10px 7px 28px",
          }}
        />
      </div>

      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 10,
            right: 10,
            marginTop: 4,
            background: "white",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 50,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {results.map((r) => {
            const Icon = TYPE_ICON[r.type];
            return (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => handleSelect(r)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "10px 12px",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <Icon size={14} color="var(--text-secondary)" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{r.sublabel}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
