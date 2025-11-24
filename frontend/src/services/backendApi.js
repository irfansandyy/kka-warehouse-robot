import axios from "axios";
import { API_BASE, API_TIMEOUT } from "../constants/config";

const client = axios.create({
  baseURL: API_BASE,
  timeout: API_TIMEOUT,
});

async function post(path, payload) {
  const response = await client.post(path, payload);
  return response.data;
}

async function get(path) {
  const response = await client.get(path);
  return response.data;
}

export const backendApi = {
  generateMap: (payload) => post("/generate_map", payload),
  planTasks: (payload) => post("/plan_tasks", payload),
  computePaths: (payload) => post("/compute_paths", payload),
  replan: (payload) => post("/replan", payload),
  applyManualEdits: (payload) => post("/manual/apply", payload),
  startProgress: (payload) => post("/progress/start", payload),
  getProgress: (jobId) => get(`/progress/${jobId}`),
};
