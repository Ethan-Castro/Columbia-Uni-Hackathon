// Status-note and status-vocabulary rules (pure functions, no data writes).
//   deno test --allow-read --allow-env tests/rank_test.ts
import { isStatusDependent } from "../shared/rank.ts";
import { statesStatus } from "../shared/redact.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

Deno.test("isStatusDependent: every sample status_note is read correctly", async () => {
  const programs = JSON.parse(await Deno.readTextFile(new URL("../data/Program.json", import.meta.url))) as Array<
    { id: string; status_note: string }
  >;
  // None of the sample programs depend on status (school, WIC, CHP, IDNYC... are open to all).
  for (const p of programs) eq(isStatusDependent(p), false, `${p.id}: "${p.status_note}"`);
});

Deno.test("isStatusDependent: safe and dependent phrasings", () => {
  for (const note of [
    "Schools do not ask about immigration status.",
    "The clinic doesn't ask about status.",
    "Open to all, any immigration status.",
    "No se pregunta el estatus migratorio.",
    "Las escuelas no preguntan por su situación migratoria.",
    "Abierto a todos sin importar su estatus.",
  ]) eq(isStatusDependent({ status_note: note }), false, note);
  for (const note of [
    "Eligibility depends on immigration status.",
    "Only some immigration statuses qualify.",
    "Depende de su estatus migratorio.",
  ]) eq(isStatusDependent({ status_note: note }), true, note);
});

Deno.test("statesStatus: status statements dropped, notario 'fix papers' kept", () => {
  for (const s of ["No tengo estatus.", "Entré sin inspección.", "I overstayed my visa.", "Soy indocumentado."]) {
    eq(statesStatus(s), true, s);
  }
  eq(statesStatus("Un señor en la agencia de viajes dice que me arregla los papeles por $3,000."), false);
  eq(statesStatus("Someone at a travel agency says he can fix my papers for $3,000."), false);
});
