/**
 * mssql v12 type descriptors for the read adapter.
 *
 * mssql@12.7.14 ships as a CommonJS default-export namespace
 * (`module.exports = { ConnectionPool, Request, Int, VarChar, ... }`).
 *
 * This module always exposes the real driver descriptors, never aliases or
 * `Symbol.for()` handles, so `request.input(name, type, value)` receives the
 * actual `mssql` type constructor required by mssql@12.
 */
import mssql from 'mssql';

const catalog: Readonly<Record<string, unknown>> = {
  Int: mssql.Int,
  VarChar: mssql.VarChar,
  NVarChar: mssql.NVarChar,
  NText: mssql.NText,
  Decimal: mssql.Decimal,
  Date: mssql.Date,
  DateTime: mssql.DateTime,
  Float: mssql.Float,
  Real: mssql.Real,
  Bit: mssql.Bit,
  BigInt: mssql.BigInt,
  SmallInt: mssql.SmallInt,
  TinyInt: mssql.TinyInt,
  UniqueIdentifier: mssql.UniqueIdentifier,
  VarBinary: mssql.VarBinary,
  Binary: mssql.Binary,
  Money: mssql.Money,
  SmallMoney: mssql.SmallMoney,
  Geography: mssql.Geography,
  Geometry: mssql.Geometry,
};

export const mssqlTypes = Object.freeze(catalog);

export type mssqlType = (typeof mssqlTypes)[keyof typeof mssqlTypes];

export function typeOf(name: string): mssqlType {
  if (!(name in catalog)) {
    throw new Error(`unknown mssql type "${name}" for parameter "${name}"`);
  }
  return catalog[name] as mssqlType;
}
