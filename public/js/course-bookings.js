$(document).ready(function() {
  $('#bookingsTable').DataTable({
    order: [[4, 'desc']],
    pageLength: 25,
    responsive: true,
    columnDefs: [
      { targets: [0], width: '150px' },
      { targets: [1], width: '150px' },
      { targets: [2], width: '90px', type: 'date' },
      { targets: [3], width: '90px', type: 'num' },
      { targets: [4], width: '90px', type: 'date' },
      { targets: [5, 6, 7], width: '100px' },
      { targets: [8], width: '160px' }
    ],
    language: {
      search: 'Search bookings:',
      lengthMenu: 'Show _MENU_ bookings per page',
      info: 'Showing _START_ to _END_ of _TOTAL_ bookings'
    }
  });

  function styleIntegrationLinks() {
    $('#bookingsTable tbody tr').each(function() {
      const cells = $(this).find('td');
      const mappings = [
        { index: 5, icon: '/lib/icons/hubspot.ico' },
        { index: 6, icon: '/lib/icons/forecast.png' },
        { index: 7, icon: '/lib/icons/calendar.svg' }
      ];

      mappings.forEach(function(mapping) {
        const cell = $(cells[mapping.index]);
        const link = cell.find('a');
        if (link.length) {
          link.addClass('btn btn-sm btn-outline-primary');
          link.attr('target', '_blank');
          link.text('');
          if (mapping.icon) {
            link.prepend('<img src="' + mapping.icon + '" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:6px;">');
          }
        }
      });
    });
  }

  styleIntegrationLinks();
  $('#bookingsTable').on('draw.dt', styleIntegrationLinks);

  $('#pipelineSelect').on('change', function() {
    var pipelineId = this.value;
    if (pipelineId) {
      window.location.href = '/course-bookings?pipeline=' + encodeURIComponent(pipelineId);
    }
  });
});


