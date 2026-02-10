
export type AccountType = 'CC' | 'LC' | 'TARJETA';
export type MovementType = 'ABONO' | 'CARGO' | 'TRANSFERENCIA';
export type AccountStatus = 'PENDIENTE' | 'PAGADA' | 'PARCIAL';
export type PaymentMethod = 'EFECTIVO' | 'TARJETA_CREDITO';
export type CategoryType = 'Gastos Casa' | 'Tarjeta de credito' | 'Seguros' | 'Tag' | 'Prestamos' | 'Gastos Operacionales' | 'Otros';

export interface Cuenta {
  id: string;
  nombre: string;
  banco: string;
  tipo: AccountType;
  numeroRef: string;
  activo: boolean;
}

export interface SaldoDiario {
  id: string;
  fecha: string; // YYYY-MM-DD
  cuentaId: string;
  saldo: number;
}

export interface Movimiento {
  id: string;
  fecha: string;
  tipo: MovementType;
  monto: number;
  descripcion: string;
  cuentaDesdeId: string | null;
  cuentaHaciaId: string | null;
  observaciones: string;
}

export interface CuentaPendiente {
  id: string;
  mes: string; // YYYY-MM-01
  descripcion: string;
  tipoPago: PaymentMethod;
  categoria: CategoryType;
  monto: number;
  saldo: number;
  vencimiento: string | null;
  estado: AccountStatus;
  observaciones: string;
  cuotaActual?: number;
  cuotasTotales?: number;
  groupId?: string; // Nuevo: ID para agrupar cuotas
}

export interface SuggestedDescription {
  descripcion: string;
  tipoPago: PaymentMethod;
  categoria: CategoryType;
}

export interface IngresoRecibir {
  id: string;
  fecha: string;
  monto: number;
  descripcion: string;
}

export interface Parametros {
  lineaCreditoMonto: number;
}

export interface UIState {
  mesConsulta: string; // YYYY-MM-01
  filtros: {
    texto: string;
    tipoMov: string | 'TODOS';
  };
  loading: boolean;
}
