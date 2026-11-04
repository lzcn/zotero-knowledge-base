#include "inference-backend.h"
#include "embedding.h"
#include <cassert>
#include <limits>

int main(int argc, char **argv) {
  assert(argc == 2);
  InferenceBackend backend(argv[1], [](Ort::Env &, const char *) -> std::unique_ptr<Ort::Session> {
    throw std::runtime_error("Simulated unavailable platform provider");
  }, "unavailable");
  assert(std::string(backend.backend()) == "cpu");
  std::vector<float> hidden(256 * 384, 0);
  hidden[0] = 3; hidden[1] = 4;
  std::vector<int64_t> attention(256, 0);
  attention[0] = 1;
  const auto vector = poolEmbedding(hidden.data(), attention);
  assert(std::abs(vector[0] - 0.6) < 1e-12 && std::abs(vector[1] - 0.8) < 1e-12);
  hidden[0] = std::numeric_limits<float>::quiet_NaN();
  bool rejected = false;
  try { poolEmbedding(hidden.data(), attention); }
  catch (const std::runtime_error &) { rejected = true; }
  assert(rejected);
  attention[0] = 0; rejected = false;
  try { poolEmbedding(hidden.data(), attention); }
  catch (const std::runtime_error &) { rejected = true; }
  assert(rejected);
}
