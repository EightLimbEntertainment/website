document.addEventListener("DOMContentLoaded", function () {
  const list = document.querySelector('.long-track-list');
  if (!list) return;
  const listItems = Array.from(list.children); // Convert NodeList to an Array
  
  // Split the list items into two arrays (left and right columns)
  const halfwayIndex = Math.ceil(listItems.length / 2); // Get the halfway point
  const leftColumnItems = listItems.slice(0, halfwayIndex);
  const rightColumnItems = listItems.slice(halfwayIndex);

  // Create two new ul elements for each column
  const leftColumn = document.createElement('ul');
  leftColumn.classList.add('left-column');
  const rightColumn = document.createElement('ul');
  rightColumn.classList.add('right-column');

  // Append the left items to the left column ul
  leftColumnItems.forEach(item => leftColumn.appendChild(item));

  // Append the right items to the right column ul
  rightColumnItems.forEach(item => rightColumn.appendChild(item));

  // Empty the original list and append the two new lists
  const wrapper = document.querySelector('.long-track-list-wrapper');
  wrapper.innerHTML = ''; // Clear the original content
  wrapper.appendChild(leftColumn);
  wrapper.appendChild(rightColumn);
});
