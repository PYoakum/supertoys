function downloadTableAsCSV(filename = 'table.csv') {
    console.log('click')
    const table = document.getElementById('editable-table');
    const rows = Array.from(table.querySelectorAll('tr'));
        
    const csv = rows.map(row => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        return cells.map(cell => {

            // saves the header values
            if(cell.innerText !== (null || undefined || '')){

                let text = cell.innerText.replace(/"/g, '""');
                return text.toString();

            // saves the cell values
            } else {

                let text = cell.children[0].value.replace(/"/g, '""');
                return text.toString();

            }

            //let text = cell.children[0].value.replace(/"/g, '""');
            //let text = cell.innerText.replace(/"/g, '""');
            //return text.toString();

        }).join(',');
    }).join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function handleDLEvent(event) {
    if (event.type === "click"){
        console.log('downloading...')
        downloadTableAsCSV(document.getElementById('fn-input').value)
    }
} 

function init(){

    document.getElementById('dl-btn').addEventListener("click", (e) => handleDLEvent(e))
    
}


window.addEventListener ?
window.addEventListener("load", init, false) :
window.attachEvent && window.attachEvent("onload", init);