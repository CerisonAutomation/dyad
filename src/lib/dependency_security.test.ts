import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
it("escapes attacker-controlled identifier quotes rather than emitting executable SQL",()=>{
  const query=new SQLiteSyncDialect().sqlToQuery(sql`select * from ${sql.identifier('users"; DROP TABLE chats; --')}`);
  expect(query.sql).toBe('select * from "users""; DROP TABLE chats; --"');
  expect(query.params).toEqual([]);
});
it("keeps values parameterized when identifiers require escaping",()=>{
  const query=new SQLiteSyncDialect().sqlToQuery(sql`select ${sql.identifier('a"b')} where x = ${"' OR 1=1 --"}`);
  expect(query.sql).toBe('select "a""b" where x = ?'); expect(query.params).toEqual(["' OR 1=1 --"]);
});
