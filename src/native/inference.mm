// Isolated ONNX inference process. EOF or termination cancels the session.
#import <Foundation/Foundation.h>
#include <onnxruntime_cxx_api.h>
#include <iostream>
#include <vector>
#include <cmath>
#include <memory>
#include <sys/resource.h>

static void reply(NSDictionary *value) {
  NSData *bytes = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  std::cout.write((const char *)bytes.bytes, bytes.length);
  std::cout << std::endl;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 3 || argc > 4) return 2;
    setpriority(PRIO_PROCESS, 0, 10);
    Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "knowledge-base");
    std::unique_ptr<Ort::Session> session;
    bool coreml = argc != 4 || std::string(argv[3]) != "cpu";
    auto load = [&](bool accelerated) {
      Ort::SessionOptions options;
      options.SetIntraOpNumThreads(1);
      options.SetInterOpNumThreads(1);
      Ort::ThrowOnError(Ort::GetApi().AddFreeDimensionOverrideByName(options, "batch_size", 1));
      Ort::ThrowOnError(Ort::GetApi().AddFreeDimensionOverrideByName(options, "sequence_length", 256));
      if (accelerated) {
        NSString *cache = @(argv[2]);
        NSError *error = nil;
        if (![[NSFileManager defaultManager] createDirectoryAtPath:cache withIntermediateDirectories:YES attributes:nil error:&error])
          throw std::runtime_error(error.localizedDescription.UTF8String);
        options.AppendExecutionProvider("CoreML", {
          {"ModelFormat", "MLProgram"}, {"MLComputeUnits", "ALL"},
          {"RequireStaticInputShapes", "1"}, {"ModelCacheDirectory", cache.UTF8String}
        });
      }
      return std::make_unique<Ort::Session>(env, argv[1], options);
    };
    try {
      try { session = load(coreml); }
      catch (const std::exception &error) {
        if (!coreml) throw;
        std::cerr << "Core ML initialization failed: " << error.what() << std::endl;
        coreml = false;
        session = load(false);
      }
      reply(@{@"ready": @YES, @"backend": coreml ? @"coreml+cpu" : @"cpu"});
      std::string line;
      while (std::getline(std::cin, line)) {
        @autoreleasepool {
          try {
            if (line.size() > 65536) throw std::runtime_error("Request too large");
            NSData *bytes = [NSData dataWithBytes:line.data() length:line.size()];
            NSDictionary *request = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
            if (![request isKindOfClass:NSDictionary.class]) throw std::runtime_error("Invalid request");
            NSArray *ids = request[@"input_ids"], *mask = request[@"attention_mask"];
            NSArray *types = request[@"token_type_ids"];
            if (![ids isKindOfClass:NSArray.class] || ![mask isKindOfClass:NSArray.class] ||
                ids.count != 256 || mask.count != 256 ||
                (types && (![types isKindOfClass:NSArray.class] || types.count != 256)))
              throw std::runtime_error("Expected one 256-token input");
            std::vector<int64_t> tokenIds(256), attention(256), tokenTypes(256, 0);
            for (size_t i = 0; i < 256; ++i) {
              if (![ids[i] isKindOfClass:NSNumber.class] || ![mask[i] isKindOfClass:NSNumber.class] ||
                  (types && ![types[i] isKindOfClass:NSNumber.class])) throw std::runtime_error("Invalid token");
              tokenIds[i] = [ids[i] longLongValue]; attention[i] = [mask[i] longLongValue];
              if (types) tokenTypes[i] = [types[i] longLongValue];
              if (tokenIds[i] < 0 || tokenIds[i] >= 30522 || attention[i] < 0 || attention[i] > 1 ||
                  tokenTypes[i] < 0 || tokenTypes[i] > 1) throw std::runtime_error("Token out of range");
            }
            int64_t shape[] = {1, 256};
            auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
            std::vector<Ort::Value> inputs;
            for (auto *values : {&tokenIds, &attention, &tokenTypes})
              inputs.push_back(Ort::Value::CreateTensor<int64_t>(memory, values->data(), 256, shape, 2));
            const char *names[] = {"input_ids", "attention_mask", "token_type_ids"};
            const char *outputNames[] = {"last_hidden_state"};
            std::vector<Ort::Value> outputs;
            try { outputs = session->Run(Ort::RunOptions{nullptr}, names, inputs.data(), 3, outputNames, 1); }
            catch (const std::exception &error) {
              if (!coreml) throw;
              std::cerr << "Core ML inference failed: " << error.what() << std::endl;
              coreml = false; session = load(false);
              outputs = session->Run(Ort::RunOptions{nullptr}, names, inputs.data(), 3, outputNames, 1);
            }
            if (outputs[0].GetTensorTypeAndShapeInfo().GetElementCount() != 256 * 384)
              throw std::runtime_error("Invalid output dimensions");
            const float *hidden = outputs[0].GetTensorData<float>();
            std::vector<double> vector(384, 0);
            double count = 0, norm = 0;
            for (size_t t = 0; t < 256; ++t) if (attention[t]) {
              ++count;
              for (size_t d = 0; d < 384; ++d) vector[d] += hidden[t * 384 + d];
            }
            if (!count) throw std::runtime_error("Empty input");
            for (auto &value : vector) { value /= count; norm += value * value; }
            if (!std::isfinite(norm) || norm <= 0) throw std::runtime_error("Invalid output values");
            NSMutableArray *result = [NSMutableArray arrayWithCapacity:384];
            for (double value : vector) [result addObject:@(value / std::sqrt(norm))];
            reply(@{@"vector": result, @"backend": coreml ? @"coreml+cpu" : @"cpu"});
          } catch (const std::exception &error) { reply(@{@"error": @(error.what())}); }
        }
      }
    } catch (const std::exception &error) {
      reply(@{@"error": @(error.what())}); return 1;
    }
  }
  return 0;
}
