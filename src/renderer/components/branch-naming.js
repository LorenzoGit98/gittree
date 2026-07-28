const BranchNaming = {
  aliases: {
    feature: ['feature', 'features', 'feat'],
    bugfix: ['bugfix', 'bug', 'fix', 'hotfix']
  },

  branchNames(metadata = {}) {
    return (metadata.branches || [])
      .map(branch => {
        const name = String(branch.name || '');
        if (branch.kind !== 'remote') return name;
        const remote = String(branch.remote || '');
        return remote && name.startsWith(`${remote}/`)
          ? name.slice(remote.length + 1)
          : name.split('/').slice(1).join('/');
      })
      .filter(Boolean);
  },

  detectPrefix(type, metadata = {}) {
    const aliases = this.aliases[type] || [];
    const counts = new Map(aliases.map(alias => [alias, 0]));
    this.branchNames(metadata).forEach(name => {
      const prefix = name.split('/')[0].toLowerCase();
      if (counts.has(prefix)) counts.set(prefix, counts.get(prefix) + 1);
    });
    return aliases.reduce(
      (best, candidate) => counts.get(candidate) > counts.get(best) ? candidate : best,
      aliases[0] || type
    );
  },

  slugify(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '');
  },

  compose(type, value, metadata = {}) {
    if (type === 'custom') {
      return String(value || '')
        .split('/')
        .map(part => this.slugify(part))
        .filter(Boolean)
        .join('/');
    }
    const slug = this.slugify(value);
    if (!slug) return '';
    return `${this.detectPrefix(type, metadata)}/${slug}`;
  }
};
