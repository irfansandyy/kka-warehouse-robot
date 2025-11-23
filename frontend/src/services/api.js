import axios from "axios";
import { BACKEND_URL } from "../constants";

export async function generateMap(config) {
  const response = await axios.post(`${BACKEND_URL}/generate_map`, config);
  return response.data;
}

export async function planTasks(config) {
  const response = await axios.post(`${BACKEND_URL}/plan_tasks`, config);
  return response.data;
}

export async function computePaths(config) {
  const response = await axios.post(`${BACKEND_URL}/compute_paths`, config);
  return response.data;
}

export async function replanPath(config) {
  const response = await axios.post(`${BACKEND_URL}/replan`, config);
  return response.data;
}

export async function applyManualEdits(config) {
  const response = await axios.post(`${BACKEND_URL}/manual/apply`, config);
  return response.data;
}
