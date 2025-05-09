async function runMaintenance(supabase) {
  // Reset rank_updated flag for all projects where it is currently true
  try {
    const { error } = await supabase
      .from('Projects')
      .update({ rank_updated: false })
      .eq('rank_updated', true);  // Only update rows where rank_updated is TRUE

    if (error) {
      console.error(
        `[${new Date().toISOString()}] Maintenance error: ${error.message}`
      );
    } else {
      console.log(
        `[${new Date().toISOString()}] rank_updated flag reset to false for projects where it was true`
      );
    }
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Unexpected error in runMaintenance:`,
      err
    );
  }
}

module.exports = { runMaintenance };
