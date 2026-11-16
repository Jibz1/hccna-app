import Foundation

@main
struct FontRegistryStress {
  static func main() {
    for _ in 0..<10 {
      var queries = 0
      let registry = FontRegistry {
        queries += 1
        Thread.sleep(forTimeInterval: 0.0001)
        return ["embedded"]
      }
      precondition(queries == 0, "Native font discovery must remain lazy")
      DispatchQueue.concurrentPerform(iterations: 2_000) { index in
        if index.isMultiple(of: 4) {
          registry.register(["font-\(index)", "shared"])
        } else {
          precondition(registry.getLoadedFonts().contains("embedded"))
        }
      }
      let loaded = registry.getLoadedFonts()
      let expected = Set(["embedded", "shared"] + stride(from: 0, to: 2_000, by: 4).map { "font-\($0)" })
      precondition(Set(loaded) == expected, "Concurrent registration lost font names")
      precondition(loaded.count == expected.count, "Font names must be unique")
      precondition(queries == 1, "Native font discovery must run exactly once")
    }
    print("Font registry: 20,000 concurrent operations passed")
  }
}
