async function runMaintenance(supabase) {
  // Reset rank_updated flag for all projects
  try {
    const { error } = await supabase
      .from('Projects')
      .update({ rank_updated: false });

    if (error) {
      console.error(
        `[${new Date().toISOString()}] Maintenance error: ${error.message}`
      );
    } else {
      console.log(
        `[${new Date().toISOString()}] rank_updated flag reset to false for all Projects`
      );
    }
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Unexpected error in runMaintenance:`,
      err
    );
  }
}
