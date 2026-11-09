import { redirect } from "next/navigation";

// Settings is split into sections (see SettingsNav); open the first one.
export default function SettingsIndex() {
  redirect("/settings/fees");
}
