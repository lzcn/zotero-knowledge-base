// Isolated ONNX inference process. EOF or termination cancels the session.
#import <Foundation/Foundation.h>
#include <onnxruntime_cxx_api.h>
#include <iostream>
#include <vector>
#include <cmath>
#include <memory>
#include <sys/resource.h>
#include "coreml-backend.h"
#include "embedding.h"

static void reply(NSDictionary *value) {
  NSData *bytes = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  std::cout.write((const char *)bytes.bytes, bytes.length);
  std::cout << std::endl;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 3 || argc > 4) return 2;
    setpriority(PRIO_PROCESS, 0, 10);
    const bool accelerated = argc != 4 || std::string(argv[3]) != "cpu";
    std::string cache = argv[2];
    try {
      InferenceBackend model(argv[1], accelerated ? coreMLBackend(cache) : InferenceBackend::Factory{}, "coreml+cpu");
      reply(@{@"ready": @YES, @"backend": @(model.backend())});
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
            auto outputs = model.run(names, inputs, outputNames);
            if (outputs[0].GetTensorTypeAndShapeInfo().GetElementCount() != 256 * 384)
              throw std::runtime_error("Invalid output dimensions");
            const float *hidden = outputs[0].GetTensorData<float>();
            const auto vector = poolEmbedding(hidden, attention);
            NSMutableArray *result = [NSMutableArray arrayWithCapacity:vector.size()];
            for (double value : vector) [result addObject:@(value)];
            reply(@{@"vector": result, @"backend": @(model.backend())});
          } catch (const std::exception &error) { reply(@{@"error": @(error.what())}); }
        }
      }
    } catch (const std::exception &error) {
      reply(@{@"error": @(error.what())}); return 1;
    }
  }
  return 0;
}
