<script>
  import { currentVariant, availableVariants, setVariant } from '../stores/jobStore.js';
  let isOpen = false;
  function toggleSelector() {
    isOpen = !isOpen;
  }
  function selectVariant(variant) {
    setVariant(variant);
    isOpen = false;
  }
</script>
<div class="variant-selector" class:open={isOpen}>
  <button class="selector-toggle" on:click={toggleSelector}>
    <span class="selector-title">📰 Edition</span>
    <span class="selector-arrow" class:rotated={isOpen}>▼</span>
  </button>
  {#if isOpen}
    <div class="selector-dropdown">
      {#each $availableVariants as variant}
        <button 
          class="variant-option" 
          class:active={$currentVariant === variant.key}
          on:click={() => selectVariant(variant.key)}
        >
          {variant.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
<style>
  .variant-selector {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
    font-family: 'Crimson Text', serif;
  }
  .selector-toggle {
    background: white;
    border: 2px solid var(--newspaper-black);
    padding: 12px 16px;
    font-family: 'Playfair Display', serif;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: all 0.2s ease;
    min-width: 140px;
    justify-content: space-between;
  }
  .selector-toggle:hover {
    background: var(--newspaper-light-gray);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(0,0,0,0.2);
  }
  .selector-arrow {
    transition: transform 0.2s ease;
    font-size: 0.8rem;
  }
  .selector-arrow.rotated {
    transform: rotate(180deg);
  }
  .selector-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: white;
    border: 2px solid var(--newspaper-black);
    border-top: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    max-height: 300px;
    overflow-y: auto;
  }
  .variant-option {
    display: block;
    width: 100%;
    padding: 10px 16px;
    border: none;
    background: white;
    font-family: 'Crimson Text', serif;
    font-size: 0.95rem;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s ease;
    border-bottom: 1px solid var(--newspaper-border);
  }
  .variant-option:last-child {
    border-bottom: none;
  }
  .variant-option:hover {
    background: var(--newspaper-light-gray);
  }
  .variant-option.active {
    background: var(--newspaper-black);
    color: white;
    font-weight: 600;
  }
  .variant-option.active:hover {
    background: #333;
  }
  /* Mobile responsive */
  @media (max-width: 768px) {
    .variant-selector {
      position: static;
      margin-bottom: 20px;
      width: 100%;
    }
    .selector-toggle {
      width: 100%;
    }
  }
</style>