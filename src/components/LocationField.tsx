// Managed-picklist location input: type to add a new place or pick an existing
// one from the datalist. The server (resolveLocation) de-dupes by name. Plain
// component (no hooks) so it works in both server and client forms.
export default function LocationField({
  locations,
  defaultValue,
  id = "locations-dl"
}: {
  locations: string[];
  defaultValue?: string;
  id?: string;
}) {
  return (
    <div>
      <label className="label">
        Location <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <input
        name="location"
        list={id}
        defaultValue={defaultValue}
        autoComplete="off"
        className="input"
        placeholder="e.g. Book Off, Thrift store — pick or type"
      />
      <datalist id={id}>
        {locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </div>
  );
}
