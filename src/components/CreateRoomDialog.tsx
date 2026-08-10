import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "./Modal";
import { IconFolder } from "./icons";

interface Props {
  onCreate: (name: string, folderPath: string) => void;
  onClose: () => void;
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:bg-neutral-900";

export function CreateRoomDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setFolderPath(selected);
      if (!name) {
        const parts = selected.split(/[/\\]/).filter(Boolean);
        setName(parts[parts.length - 1] ?? "");
      }
    }
  }

  return (
    <Modal
      title="Tạo phòng mới"
      subtitle="Một phòng gắn với một thư mục dự án trên máy"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
            disabled={!name || !folderPath}
            onClick={() => onCreate(name, folderPath)}
          >
            Tạo phòng
          </button>
        </>
      }
    >
      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Tên phòng
      </label>
      <input
        className={`mb-4 ${inputClass}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ví dụ: Dự án ABC"
        autoFocus
      />

      <label className="mb-1.5 block text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Thư mục dự án
      </label>
      <div className="flex gap-2">
        <input className={`flex-1 truncate ${inputClass}`} value={folderPath} readOnly placeholder="Chưa chọn thư mục" />
        <button
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          onClick={pickFolder}
        >
          <IconFolder className="h-4 w-4" />
          Chọn...
        </button>
      </div>
    </Modal>
  );
}
