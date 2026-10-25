const $ = (id) => document.getElementById(id);
const sections = [
  ["legacyBranding", "Product copy & branding"],
  ["hostedAccount", "Account & cloud runtime"],
  ["dyadEntitlement", "Entitlements"],
  ["billingQuota", "Billing & quotas"],
  ["hostedService", "Hosted services"],
  ["tools", "Agent tools"],
  ["agent", "Agents & delegation"],
  ["preview", "Preview surfaces"],
  ["inference", "Model routing"],
  ["ipc", "IPC endpoints"],
  ["modules", "Dependency map"],
];
let map,
  section = "dyadEntitlement",
  limit = 100;
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
for (const [key, label] of sections) {
  const button = el("button", label);
  button.dataset.section = key;
  button.onclick = () => {
    section = key;
    limit = 100;
    render();
  };
  $("nav").append(button);
}
function render() {
  if (!map) return;
  for (const button of $("nav").children)
    button.classList.toggle("active", button.dataset.section === section);
  const query = $("search").value.toLowerCase();
  const runtimeOnly = $("scope").value === "runtime";
  let rows =
    section === "tools"
      ? map.tools
      : section === "modules"
        ? map.modules
        : section === "ipc"
          ? map.ipc
          : map.findings.filter((r) => r.category === section);
  rows = rows.filter(
    (r) =>
      (!runtimeOnly ||
        r.scope === "runtime" ||
        (r.scope === undefined &&
          /^(src|workers|shared)\//.test(r.file) &&
          !/\.(test|spec)\./.test(r.file))) &&
      (!query || JSON.stringify(r).toLowerCase().includes(query)),
  );
  $("count").textContent =
    `${rows.length.toLocaleString()} matching records · showing ${Math.min(limit, rows.length).toLocaleString()}`;
  const content = document.createDocumentFragment();
  for (const row of rows.slice(0, limit)) {
    const card = el("article", undefined, "item");
    card.append(
      el(
        "h3",
        row.identifier
          ? `${row.identifier} · ${row.name}`
          : `${row.file}${row.line ? ":" + row.line : ""}`,
      ),
    );
    if (row.identifier) card.append(el("small", `${row.file}:${row.line}`));
    if (row.evidence) card.append(el("pre", row.evidence));
    if (section === "tools") {
      card.append(
        el(
          "p",
          `Consent: ${row.defaultConsent ?? "unspecified"} · Modifies state: ${row.modifiesState ?? "unspecified"} · Engine endpoint: ${row.usesEngineEndpoint ?? "not flagged"}`,
        ),
      );
      card.append(
        el(
          "pre",
          `Eligibility: ${row.isEnabled ?? "unspecified"}\nDiscovery: ${row.isDiscoverable ?? "default"}\n${row.description ?? ""}`,
        ),
      );
    }
    if (section === "ipc")
      card.append(el("pre", `${row.callee}(${row.channel ?? ""})`));
    if (section === "modules") {
      const outgoing = map.edges.filter((e) => e.from === row.file),
        incoming = map.edges.filter((e) => e.to === row.file);
      card.append(
        el(
          "small",
          `${row.scope} · ${outgoing.length} imports · ${incoming.length} consumers · ${row.exports.length} exported declarations`,
        ),
      );
      const detail = el("details");
      detail.append(el("summary", "Inspect dependency edges"));
      detail.append(
        el(
          "pre",
          `IMPORTS\n${outgoing.map((e) => `${e.specifier} → ${e.to ?? "external / unresolved"}`).join("\n")}\n\nCONSUMERS\n${incoming.map((e) => e.from).join("\n")}`,
        ),
      );
      card.append(detail);
    }
    content.append(card);
  }
  $("results").replaceChildren(content);
  $("more").hidden = rows.length <= limit;
}
async function load() {
  try {
    const response = await fetch("/api/map");
    if (!response.ok) throw new Error(`Map returned HTTP ${response.status}`);
    map = await response.json();
    $("stats").replaceChildren(
      ...[
        ["Modules", map.counts.modules],
        ["Import edges", map.counts.imports],
        ["Tool declarations", map.counts.tools],
        ["IPC registrations", map.counts.ipc],
      ].map(([label, value]) => {
        const card = el("div", undefined, "stat");
        card.append(
          el("strong", value.toLocaleString()),
          el("span", label, "muted"),
        );
        return card;
      }),
    );
    render();
  } catch (error) {
    $("count").textContent = `Unable to load audit: ${error.message}`;
  }
}
$("search").oninput = $("scope").onchange = () => {
  limit = 100;
  render();
};
$("more").onclick = () => {
  limit += 100;
  render();
};
$("reload").onclick = load;
await load();
