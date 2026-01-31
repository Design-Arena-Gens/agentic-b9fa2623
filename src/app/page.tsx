"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type CallStatus = "pending" | "in-progress" | "completed" | "no-answer";

type Contact = {
  id: string;
  name: string;
  phone: string;
  remark: string;
  status: CallStatus;
  rowNumber: number;
};

const STORAGE_KEY = "call-assistant-contacts";

const STATUS_LABELS: Record<CallStatus, string> = {
  pending: "Pending",
  "in-progress": "In Progress",
  completed: "Completed",
  "no-answer": "No Answer",
};

const STATUS_BADGE_COLOR: Record<CallStatus, string> = {
  pending: "bg-amber-100 text-amber-700 border border-amber-200",
  "in-progress": "bg-blue-100 text-blue-700 border border-blue-200",
  completed: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "no-answer": "bg-rose-100 text-rose-700 border border-rose-200",
};

const pickValue = (
  row: Record<string, unknown>,
  candidates: string[],
  fallback = "",
) => {
  const lowerKeys = Object.keys(row).reduce<Record<string, string>>(
    (acc, key) => {
      acc[key.toLowerCase()] = key;
      return acc;
    },
    {},
  );

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (lowerKeys[normalized]) {
      const value = row[lowerKeys[normalized]];
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
  }

  for (const [lowerKey, originalKey] of Object.entries(lowerKeys)) {
    if (candidates.some((candidate) => lowerKey.includes(candidate))) {
      const value = row[originalKey];
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
  }

  return fallback;
};

const safeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `contact-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const formatPhoneNumber = (value: string) => {
  return value.replace(/[^\d+]/g, "");
};

const parseWorkbook = async (file: File): Promise<Contact[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const [firstSheetName] = workbook.SheetNames;
  const worksheet = workbook.Sheets[firstSheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
  });

  const contacts: Contact[] = [];
  rows.forEach((row, index) => {
    const phone = formatPhoneNumber(
      pickValue(row, ["phone", "phone number", "mobile", "contact", "number"]),
    );

    if (!phone) {
      return;
    }

    const name = pickValue(
      row,
      ["name", "customer", "contact name", "full name"],
      `Contact ${index + 1}`,
    );

    const remark = pickValue(row, ["remark", "remarks", "notes", "note"], "");
    const status = pickValue(
      row,
      ["status", "call status"],
      "pending",
    ).toLowerCase() as CallStatus;

    const normalizedStatus: CallStatus = STATUS_LABELS[status as CallStatus]
      ? status
      : "pending";

    contacts.push({
      id: safeId(),
      name,
      phone,
      remark,
      status: normalizedStatus,
      rowNumber: index + 2,
    });
  });

  return contacts;
};

const downloadWorkbook = (contacts: Contact[], fileName: string) => {
  const worksheet = XLSX.utils.json_to_sheet(
    contacts.map((contact) => ({
      Name: contact.name,
      Phone: contact.phone,
      Status: STATUS_LABELS[contact.status],
      Remark: contact.remark,
    })),
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Contacts");
  XLSX.writeFile(workbook, fileName || "call-updates.xlsx");
};

export default function Home() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [fileName, setFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [filterStatus, setFilterStatus] = useState<CallStatus | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [copyFeedbackId, setCopyFeedbackId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualRemark, setManualRemark] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as {
        contacts: Contact[];
        fileName: string;
      };
      setContacts(parsed.contacts);
      setFileName(parsed.fileName);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (contacts.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ contacts, fileName }),
    );
  }, [contacts, fileName]);

  const handleImport = useCallback(async (file: File) => {
    setIsImporting(true);
    try {
      const importedContacts = await parseWorkbook(file);
      setContacts(importedContacts);
      setFileName(file.name);
    } finally {
      setIsImporting(false);
    }
  }, []);

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }
    void handleImport(file);
    event.target.value = "";
  };

  const appliedContacts = useMemo(() => {
    return contacts.filter((contact) => {
      const matchesStatus =
        filterStatus === "all" ? true : contact.status === filterStatus;
      const matchesSearch =
        searchTerm.trim().length === 0
          ? true
          : contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            contact.phone.includes(searchTerm.replace(/[^\d+]/g, ""));

      return matchesStatus && matchesSearch;
    });
  }, [contacts, filterStatus, searchTerm]);

  const updateContact = (id: string, updates: Partial<Contact>) => {
    setContacts((current) =>
      current.map((contact) =>
        contact.id === id ? { ...contact, ...updates } : contact,
      ),
    );
  };

  const handleExport = () => {
    const exportName = fileName
      ? fileName.replace(/\.xlsx?$/i, "") + "-updated.xlsx"
      : "call-updates.xlsx";
    downloadWorkbook(contacts, exportName);
  };

  const handleClear = () => {
    setContacts([]);
    setFileName("");
    setFilterStatus("all");
    setSearchTerm("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const handleCopy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedbackId(id);
      setTimeout(() => {
        setCopyFeedbackId((current) => (current === id ? null : current));
      }, 1500);
    } catch {
      // Best effort feedback is omitted to keep UI minimal.
    }
  };

  const addManualContact = () => {
    const cleanedPhone = formatPhoneNumber(manualPhone);
    if (!cleanedPhone) {
      return;
    }

    const newContact: Contact = {
      id: safeId(),
      name: manualName.trim() || `Contact ${contacts.length + 1}`,
      phone: cleanedPhone,
      remark: manualRemark.trim(),
      status: "pending",
      rowNumber: contacts.length + 1,
    };

    setContacts((current) => [newContact, ...current]);
    setManualName("");
    setManualPhone("");
    setManualRemark("");
  };

  const statusCounts = useMemo(() => {
    return contacts.reduce(
      (acc, contact) => {
        acc[contact.status] += 1;
        acc.total += 1;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        "in-progress": 0,
        completed: 0,
        "no-answer": 0,
      } as Record<CallStatus | "total", number>,
    );
  }, [contacts]);

  const renderStatusBadge = (status: CallStatus) => (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${STATUS_BADGE_COLOR[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );

  return (
    <main className="min-h-screen bg-slate-950 pb-24 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-semibold tracking-tight">
              Call Assistant Workspace
            </h1>
            {contacts.length > 0 && (
              <button
                onClick={handleClear}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-white/40 hover:text-white"
              >
                Reset Workspace
              </button>
            )}
          </div>
          <p className="max-w-3xl text-sm text-slate-300">
            Upload your contact spreadsheet, call each lead with a single tap,
            and capture live remarks without losing your progress. Your session
            is cached locally, so you can close the tab and continue later.
          </p>
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 uppercase tracking-wide text-slate-300">
              Imported Contacts: {statusCounts.total}
            </span>
            <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-3 py-1 uppercase tracking-wide text-amber-200">
              Pending: {statusCounts.pending}
            </span>
            <span className="rounded-full border border-blue-400/60 bg-blue-500/10 px-3 py-1 uppercase tracking-wide text-blue-200">
              In Progress: {statusCounts["in-progress"]}
            </span>
            <span className="rounded-full border border-emerald-400/60 bg-emerald-500/10 px-3 py-1 uppercase tracking-wide text-emerald-200">
              Completed: {statusCounts.completed}
            </span>
            <span className="rounded-full border border-rose-400/60 bg-rose-500/10 px-3 py-1 uppercase tracking-wide text-rose-200">
              No Answer: {statusCounts["no-answer"]}
            </span>
          </div>
        </header>

        <section className="grid gap-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6 shadow-xl shadow-black/30 backdrop-blur">
          <h2 className="text-lg font-semibold tracking-tight text-white">
            1. Import contact spreadsheet
          </h2>
          <div className="flex flex-col gap-4 rounded-xl border border-dashed border-white/20 bg-slate-900/70 p-6">
            <label
              htmlFor="file-input"
              className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/10 bg-slate-800/60 px-5 py-4 text-sm transition hover:border-white/30 hover:bg-slate-800/80"
            >
              <div>
                <p className="font-semibold text-white">Drop XLSX file here</p>
                <p className="text-xs text-slate-300">
                  Supports .xlsx or .xls. The first sheet will be imported.
                </p>
              </div>
              <span className="rounded-md bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-200">
                {isImporting ? "Importing..." : "Browse"}
              </span>
            </label>
            <input
              id="file-input"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileInput}
              disabled={isImporting}
            />
            {fileName && (
              <div className="flex items-center justify-between rounded-lg bg-slate-800/70 px-4 py-3 text-xs text-slate-200">
                <div className="flex flex-col">
                  <span className="font-medium text-white">{fileName}</span>
                  <span className="text-[11px] text-slate-400">
                    {contacts.length} contacts imported · First data row:
                    header row assumed at line 1
                  </span>
                </div>
                <button
                  onClick={handleExport}
                  className="rounded-md border border-emerald-400/50 px-3 py-1 text-xs font-medium text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
                >
                  Export updates
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6 shadow-xl shadow-black/30 backdrop-blur">
          <h2 className="text-lg font-semibold tracking-tight text-white">
            2. Add quick contacts
          </h2>
          <div className="grid gap-3 md:grid-cols-[2fr,2fr,3fr,auto] md:items-end">
            <div className="grid gap-1">
              <label className="text-xs uppercase tracking-wide text-slate-300">
                Name
              </label>
              <input
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400"
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs uppercase tracking-wide text-slate-300">
                Phone
              </label>
              <input
                value={manualPhone}
                onChange={(event) => setManualPhone(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400"
                placeholder="+1 555 123 4567"
              />
            </div>
            <div className="grid gap-1 md:col-span-1 md:col-start-auto">
              <label className="text-xs uppercase tracking-wide text-slate-300">
                Remark
              </label>
              <input
                value={manualRemark}
                onChange={(event) => setManualRemark(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400"
                placeholder="Notes for this contact"
              />
            </div>
            <button
              onClick={addManualContact}
              className="h-10 rounded-lg border border-indigo-400/60 bg-indigo-500/20 px-4 text-sm font-semibold uppercase tracking-wide text-indigo-100 transition hover:border-indigo-300 hover:bg-indigo-500/30"
            >
              Add Contact
            </button>
          </div>
        </section>

        <section className="grid gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl shadow-black/30 backdrop-blur">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-white">
              3. Call queue
            </h2>
            <div className="flex flex-wrap gap-3">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search name or phone"
                className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 sm:w-60"
              />
              <select
                value={filterStatus}
                onChange={(event) =>
                  setFilterStatus(event.target.value as CallStatus | "all")
                }
                className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400"
              >
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </header>

          {appliedContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-slate-950/40 px-6 py-16 text-center text-sm text-slate-400">
              <p>No contacts to show yet.</p>
              <p className="text-xs text-slate-500">
                Import a spreadsheet or add one manually to get started.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/10">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm text-slate-200">
                <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400 backdrop-blur">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Remark</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 bg-slate-950/60">
                  {appliedContacts.map((contact) => (
                    <tr key={contact.id} className="align-top">
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-white">
                            {contact.name}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Source row #{contact.rowNumber}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2">
                          <span className="text-sm font-semibold text-slate-100">
                            {contact.phone}
                          </span>
                          <div className="flex gap-2 text-xs">
                            <button
                              onClick={() =>
                                window.open(`tel:${contact.phone}`, "_self")
                              }
                              className="rounded-md border border-emerald-400/60 px-2.5 py-1 font-medium text-emerald-100 transition hover:border-emerald-300 hover:text-emerald-50"
                            >
                              Call
                            </button>
                            <button
                              onClick={() => handleCopy(contact.id, contact.phone)}
                              className="rounded-md border border-white/15 px-2.5 py-1 font-medium text-slate-200 transition hover:border-white/40 hover:text-white"
                            >
                              {copyFeedbackId === contact.id ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <select
                          value={contact.status}
                          onChange={(event) =>
                            updateContact(contact.id, {
                              status: event.target.value as CallStatus,
                            })
                          }
                          className="w-40 rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-100 outline-none transition focus:border-indigo-400"
                        >
                          {Object.entries(STATUS_LABELS).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                        <div className="mt-2">{renderStatusBadge(contact.status)}</div>
                      </td>
                      <td className="px-4 py-4">
                        <textarea
                          value={contact.remark}
                          onChange={(event) =>
                            updateContact(contact.id, {
                              remark: event.target.value,
                            })
                          }
                          placeholder="Update call notes..."
                          className="min-h-[88px] w-full rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400"
                        />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          onClick={() =>
                            setContacts((current) =>
                              current.filter((item) => item.id !== contact.id),
                            )
                          }
                          className="rounded-md border border-rose-400/60 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-300 hover:text-rose-100"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
