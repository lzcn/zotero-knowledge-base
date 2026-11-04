#pragma once
#include "inference-backend.h"
#include <filesystem>

// Apple-specific policy stays outside model preparation, pooling and ranking.
inline InferenceBackend::Factory coreMLBackend(const std::string &cache) {
  return [cache](Ort::Env &env, const char *path) {
    std::filesystem::create_directories(cache);
    auto options = InferenceBackend::options();
    options.AppendExecutionProvider("CoreML", {
      {"ModelFormat", "MLProgram"}, {"MLComputeUnits", "ALL"},
      {"RequireStaticInputShapes", "1"}, {"ModelCacheDirectory", cache}
    });
    return std::make_unique<Ort::Session>(env, path, options);
  };
}
