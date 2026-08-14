/**
 * Tipos compartidos para los formularios de herramientas (UploadForm).
 * Se usan tanto en el componente como en las páginas que lo configuran.
 */

export interface FieldOption {
  value: string;
  label: string;
}

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'radio';
  options?: FieldOption[];
  placeholder?: string;
  default?: string | number;
  min?: number;
  step?: number;
  dependsOn?: { field: string; value: string };
}

export interface SecondaryFile {
  field: string;
  label: string;
  accept: string;
}
