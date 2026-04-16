window.ROI_FALLBACK_MODEL = {
  bundle_name: "Model",
  purpose: "Pressure-duration ROI inference bundle for injector 800 at 30 C fixed context",
  fixed_context: {
    injector_id: "800",
    temp_c: 30,
  },
  supported_pressure_range_bar: [100, 350],
  supported_duration_range_us: [250, 3000],
  pressure_grid: Array.from({ length: 11 }, (_, idx) => 100 + idx * 25),
  duration_grid: Array.from({ length: 111 }, (_, idx) => 250 + idx * 25),
  output: {
    roi_unit: "mg/ms",
    time_axis_unit: "us",
    length: 7500,
  },
  future_extension_note: "This first release is pressure-duration only. Injector geometry, additional condition families, and later temperature variants are reserved for future versions.",
  bundle_load_errors: [],
  model_kind: "pdnn",
  model_label: "ModelB PDNN",
  model_id: "best_model_ModelB",
};
