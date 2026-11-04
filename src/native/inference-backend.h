#pragma once
#include <onnxruntime_cxx_api.h>
#include <functional>
#include <iostream>
#include <memory>
#include <vector>
#include <string>
#include <stdexcept>

// Model execution is independent of the host transport and platform provider.
// A platform supplies only a session factory; the CPU path is always available.
class InferenceBackend {
public:
  using Factory = std::function<std::unique_ptr<Ort::Session>(Ort::Env &, const char *)>;
  static Ort::SessionOptions options() {
    Ort::SessionOptions value;
    value.SetIntraOpNumThreads(1);
    value.SetInterOpNumThreads(1);
    Ort::ThrowOnError(Ort::GetApi().AddFreeDimensionOverrideByName(value, "batch_size", 1));
    Ort::ThrowOnError(Ort::GetApi().AddFreeDimensionOverrideByName(value, "sequence_length", 256));
    return value;
  }
  InferenceBackend(const char *path, Factory accelerated = {}, const char *name = "cpu")
      : env(ORT_LOGGING_LEVEL_WARNING, "local-embeddings"), path(path), name(name) {
    if (accelerated) {
      try { session = accelerated(env, path); return; }
      catch (const std::exception &error) {
        std::cerr << "Accelerated initialization failed: " << error.what() << std::endl;
      }
    }
    fallback();
  }
  const char *backend() const { return name; }
  std::vector<Ort::Value> run(const char *const *inputs, std::vector<Ort::Value> &values,
                             const char *const *outputs) {
    if (!session) throw std::runtime_error("Inference backend unavailable");
    try { return session->Run(Ort::RunOptions{nullptr}, inputs, values.data(), values.size(), outputs, 1); }
    catch (const std::exception &error) {
      if (std::string(name) == "cpu") throw;
      std::cerr << "Accelerated inference failed: " << error.what() << std::endl;
      fallback();
      return session->Run(Ort::RunOptions{nullptr}, inputs, values.data(), values.size(), outputs, 1);
    }
  }
private:
  Ort::Env env;
  const char *path;
  const char *name;
  std::unique_ptr<Ort::Session> session;
  void fallback() {
    name = "cpu";
    session.reset();
    auto settings = options();
    session = std::make_unique<Ort::Session>(env, path, settings);
  }
};
