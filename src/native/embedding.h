#pragma once
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

// Shared masked mean pooling and normalization for every execution backend.
inline std::vector<double> poolEmbedding(const float *hidden, const std::vector<int64_t> &attention) {
  std::vector<double> vector(384, 0);
  double count = 0, norm = 0;
  for (size_t t = 0; t < attention.size(); ++t) if (attention[t]) {
    ++count;
    for (size_t d = 0; d < vector.size(); ++d) vector[d] += hidden[t * vector.size() + d];
  }
  if (!count) throw std::runtime_error("Empty input");
  for (auto &value : vector) { value /= count; norm += value * value; }
  if (!std::isfinite(norm) || norm <= 0) throw std::runtime_error("Invalid output values");
  const double scale = std::sqrt(norm);
  for (auto &value : vector) value /= scale;
  return vector;
}
