import type { Attendance, AttendanceDraft, AuditLog, BootstrapResponse, DailyReport, Handover, Patient, PatientDraft, User } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message ?? "Não foi possível concluir a solicitação.");
  }

  return data as T;
}

export async function apiRequest<T>(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(path, { ...init, headers });
  return parseResponse<T>(response);
}

export function fetchPublicUsers() {
  return apiRequest<User[]>("/api/users/public");
}

export function login(userId: string, pin: string) {
  return apiRequest<{ token: string; user: User }>("/api/login", undefined, {
    method: "POST",
    body: JSON.stringify({ userId, pin })
  });
}

export function logout(token: string) {
  return apiRequest<{ ok: true }>("/api/logout", token, { method: "POST" });
}

export function bootstrap(token: string) {
  return apiRequest<BootstrapResponse>("/api/bootstrap", token);
}

export function createAttendance(token: string, draft: AttendanceDraft) {
  return apiRequest<Attendance>("/api/attendances", token, {
    method: "POST",
    body: JSON.stringify(draft)
  });
}

export function updateAttendance(token: string, id: string, draft: AttendanceDraft) {
  return apiRequest<Attendance>(`/api/attendances/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(draft)
  });
}

export function fetchAttendanceAudit(token: string, id: string) {
  return apiRequest<AuditLog[]>(`/api/attendances/${encodeURIComponent(id)}/audit`, token);
}

export function createPatient(token: string, draft: PatientDraft) {
  return apiRequest<Patient>("/api/patients", token, {
    method: "POST",
    body: JSON.stringify(draft)
  });
}

export function fetchDailyReport(token: string, date: string) {
  return apiRequest<DailyReport>(`/api/reports/daily?date=${encodeURIComponent(date)}`, token);
}

export function fetchCurrentHandover(token: string) {
  return apiRequest<Handover>("/api/handovers/current", token);
}

export function updateCurrentHandover(token: string, draft: Partial<Handover>) {
  return apiRequest<Handover>("/api/handovers/current", token, {
    method: "PATCH",
    body: JSON.stringify(draft)
  });
}

export function sendCurrentHandover(token: string) {
  return apiRequest<Handover>("/api/handovers/current/send", token, { method: "POST" });
}
