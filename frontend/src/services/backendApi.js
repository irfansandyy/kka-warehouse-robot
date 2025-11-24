import axios from "axios";
import { API_BASE } from "../constants/config";

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

async function post(path, payload) {
  const response = await client.post(path, payload);
  return response.data;
}

export const backendApi = {
  generateMap: (payload) => post("/generate_map", payload),
  planTasks: (payload) => post("/plan_tasks", payload),
  computePaths: (payload) => post("/compute_paths", payload),
  replan: (payload) => post("/replan", payload),
  applyManualEdits: (payload) => post("/manual/apply", payload),
};
