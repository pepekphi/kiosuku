async function maintenance24h(supabase) {
  // Reset rank_updated flag for all accounts_projects where it is currently true
  try {
    const { error } = await supabase
      .from('accounts_projects')
      .update({ rank_updated: false })
      .eq('rank_updated', true);  // Only update rows where rank_updated is TRUE

    if (error) {
      console.error(
        `[${new Date().toISOString()}] maintenance24h error: ${error.message}`
      );
    } else {
      console.log(
        `[${new Date().toISOString()}] rank_updated flag reset to false for accounts_projects where it was true`
      );
    }
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Unexpected error in maintenance24h:`,
      err
    );
  }
}

module.exports = { maintenance24h };
