// Minimal mssql v12 type declarations for KPMPL ERP SQL Server adapter.
// mssql v12 uses ConnectionPool class and exports type definitions directly.

// Phase 06B: mssql reads `pool`, `connectionTimeout` and `requestTimeout` from the top level
// of the config object; only TLS/TDS settings live under `options`.
export interface mssqlConfig {
  server: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  connectionTimeout?: number;
  requestTimeout?: number;
  pool?: {
    max: number;
    min: number;
    idleTimeoutMillis: number;
  };
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    tdsVersion?: '7_0' | '7_1' | '7_2' | '7_3_A' | '7_3_B' | '7_4';
  };
}

// mssql v12 type definitions (exported from the package)
export namespace types {
  export const NVarChar: (length?: number) => symbol;
  export const NText: symbol;
  export const Int: symbol;
  export const Decimal: (precision?: number, scale?: number) => symbol;
  export const VarChar: (length?: number) => symbol;
  export const NVarchar: (length?: number) => symbol;
  export const Float: symbol;
  export const Real: symbol;
  export const Date: symbol;
  export const DateTime: symbol;
  export const VarBinary: symbol;
  export const Binary: symbol;
  export const Money: symbol;
  export const SmallMoney: symbol;
  export const UniqueIdentifier: symbol;
  export const UniqueId: symbol;
  export const Geography: symbol;
  export const Geometry: symbol;
}

// ConnectionPool class used in mssql v12
export class ConnectionPool {
  config: mssqlConfig;
  constructor(config: mssqlConfig);
  connect(): Promise<any>;
  close(): Promise<void>;
  request(): mssqlRequest;
  on(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
}

// mssql v12 Request class
export class mssqlRequest {
  input(name: string, type: symbol | string, value: unknown): mssqlRequest;
  query(sql: string): Promise<{ recordset: any[]; rowsAffected?: number[] }>;
  // Optional: output parameter support
  output(name: string, type?: symbol | string): mssqlRequest;
}

// Export the main mssql namespace symbols that the code uses
export const NVarChar: typeof types.NVarChar;
export const NText: typeof types.NText;
export const Int: typeof types.Int;
export const Decimal: typeof types.Decimal;
export const VarChar: typeof types.VarChar;
export const NVarchar: typeof types.NVarchar;