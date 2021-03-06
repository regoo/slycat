/*
Copyright 2013, Sandia Corporation. Under the terms of Contract
DE-AC04-94AL85000 with Sandia Corporation, the U.S. Government retains certain
rights in this software.
*/

////////////////////////////////////////////////////////////////////////////////////////
// Slickgrid-based data table widget, for use with the timeseries model.

define("slycat-timeseries-table", ["d3"], function(d3)
{
  $.widget("timeseries.table",
  {
    options:
    {
      "server-root" : "",
      mid : null,
      aid : null,
      metadata : null,
      "row-selection" : [],
      "variable-selection": [],
      "sort-variable" : null,
      "sort-order" : null,
      colormap : null,
      table_filter : [],
      waveform_indexes : [],
      selection : null,
      row_count : null,
    },

    _create: function()
    {
    	var self = this;

    	function value_formatter(value)
      {
        return value == null ? "&nbsp;" : (value + "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      }

    	function cell_formatter(row, cell, value, columnDef, dataContext)
      {
        if(columnDef.colormap) {
          return "<div class='highlightWrapper" + (value==null ? " null" : "") + ( d3.hcl(columnDef.colormap(value)).l > 50 ? " light" : " dark") + "' style='background:" + columnDef.colormap(value) + "'>" + value_formatter(value) + "</div>";
        }
        else if(value==null)
          return "<div class='highlightWrapper" + (value==null ? " null" : "") + "'>" + value_formatter(value) + "</div>";
        return value_formatter(value);
      }

    	function make_column(column_index, header_class, cell_class)
      {
        return {
          id : column_index,
          field : column_index,
          name : self.options.metadata["column-names"][column_index],
          sortable : false,
          headerCssClass : header_class,
          cssClass : cell_class,
          formatter : cell_formatter,
          header :
          {
            buttons :
            [
              {
                cssClass : self.options["sort-variable"] == column_index ? (self.options["sort-order"] == "ascending" ? "icon-sort-ascending" : "icon-sort-descending") : "icon-sort-off",
                tooltip : self.options["sort-variable"] == column_index ? (self.options["sort-order"] == "ascending" ? "Sort descending" : "Sort ascending") : "Sort ascending",
                command : self.options["sort-variable"] == column_index ? (self.options["sort-order"] == "ascending" ? "sort-descending" : "sort-ascending") : "sort-ascending"
              }
            ]
          }
        };
      }

      self.columns = [];
      self.columns.push(make_column(self.options.metadata["column-count"]-1, "headerSimId", "rowSimId")); // Last column is added as simid
      for(var i = 0; i < self.options.metadata["column-count"]-1; i++) // rest of columns are added as inputs
        self.columns.push(make_column(i, "headerInput", "rowInput"));
    },

    resize_canvas: function()
    {
      var self = this;
      self.grid.resizeCanvas();
    },

    _setOption: function(key, value)
    {
      function set_sort(column, order)
      {
        self.options["sort-variable"] = column;
        self.options["sort-order"] = order;
        self.data.set_sort(column, order, function(){
          if(self.options["row-selection"].length > 0){
            var selectedRows = self.data.getSimulationRowIndexes(self.options["row-selection"]);
            self.trigger_row_selection = false;
            self.grid.setSelectedRows(selectedRows);
            self.grid.resetActiveCell();
            if(selectedRows.length)
              self.grid.scrollRowToTop(Math.min.apply(Math, selectedRows));
          }
        });
        self.element.trigger("variable-sort-changed", [column, order]);
      }

      var self = this;

      if(key == "row-selection")
      {
        // Unexpectedly at this point self.options[key] has already been set to value, so this always returns even when the row-selection is unique
        //if(self._array_equal(self.options[key], value))
        //  return;

        self.options[key] = value;

        var selectedRows = self.data.getSimulationRowIndexes(self.options["row-selection"]);
        self.trigger_row_selection = false;
        self.grid.setSelectedRows(selectedRows);
        self.grid.resetActiveCell();
        if(selectedRows.length)
          self.grid.scrollRowToTop(Math.min.apply(Math, selectedRows));
      }
      else if(key == "row-selection-silent")
      {
        self.options["row-selection"] = value;
      }
      else if(key == "variable-selection")
      {
        if(self._array_equal(self.options[key], value))
          return;

        self.options[key] = value;
        self._color_variables(value);
      }
      else if(key == "colormap")
      {
        self.options[key] = value;
        self._color_variables(self.options["variable-selection"])
      }
      else if(key == "selection")
      {
        self.options[key] = value;

        var data_table_index, waveform_index;
        var table_filter = [];
        var waveform_indexes = [];
        $.each(value, function(index, node)
        {
          data_table_index = node["data-table-index"];
          waveform_index   = node["waveform-index"];

          if(data_table_index == null)
            return;

          table_filter.push(data_table_index);
          waveform_indexes.push(waveform_index);
        });
        self.options.table_filter = table_filter;
        self.options.waveform_indexes = waveform_indexes;
        self.options.row_count = table_filter.length;

        function initialize_grid(indices){

          var sorted_table_filter = undefined;
          var retrieve_table_filter = undefined;

          if(indices !== undefined)
          {
            var sorted_rows = [];
            // Reverse response indexes for descending sort order
            if(self.options["sort-order"] == 'descending')
            {
              var plain_array = [];
              for(var i=0; i<indices.length; i++)
              {
                plain_array.push(indices[i]);
              }
              indices = plain_array.reverse();
            }
            var response = []; 
            for(var i = 0; i < self.options.table_filter.length; i++)
            {
              response.push( indices.indexOf(self.options.table_filter[i]) );
            }
            sorted_rows = new Int32Array(response);

            if(sorted_rows.length > 1)
              sorted_table_filter = Array.apply( [], sorted_rows );
            else
              sorted_table_filter = [sorted_rows[0]];
            retrieve_table_filter = sorted_table_filter.slice(0).sort(function (a, b) { return a - b });
          }

          self.data = new self._data_provider({
            server_root : self.options["server-root"],
            mid : self.options.mid,
            aid : self.options.aid,
            metadata : self.options.metadata,
            sort_column : self.options["sort-variable"],
            sort_order : self.options["sort-order"],
            table_filter : self.options.table_filter,
            row_count : self.options.row_count,
            sorted_table_filter : sorted_table_filter,
            retrieve_table_filter : retrieve_table_filter
            });

          if(self.grid) {
            self.grid.setData(self.data);
            self.data.setGrid(self.grid);
            self.grid.invalidate();
            if(self.options["row-selection"].length > 0){
              var selectedRows = self.data.getSimulationRowIndexes(self.options["row-selection"]);
              self.trigger_row_selection = false;
              self.grid.setSelectedRows(selectedRows);
              self.grid.resetActiveCell();
              if(selectedRows.length)
                self.grid.scrollRowToTop(Math.min.apply(Math, selectedRows));
            }
          }
          else {
            self.trigger_row_selection = true;
            self.grid = new Slick.Grid(self.element, self.data, self.columns, {explicitInitialization : true, enableColumnReorder : false});
            self.data.setGrid(self.grid);

            var header_buttons = new Slick.Plugins.HeaderButtons();
            header_buttons.onCommand.subscribe(function(e, args)
            {
              var column = args.column;
              var button = args.button;
              var command = args.command;
              var grid = args.grid;

              for(var i in self.columns)
              {
                self.columns[i].header.buttons[0].cssClass = "icon-sort-off";
                self.columns[i].header.buttons[0].tooltip = "Sort ascending";
                self.columns[i].header.buttons[0].command = "sort-ascending";
                grid.updateColumnHeader(self.columns[i].id);
              }

              if(command == "sort-ascending")
              {
                button.cssClass = 'icon-sort-ascending';
                button.command = 'sort-descending';
                button.tooltip = 'Sort descending';
                set_sort(column.id, "ascending");
              }
              else if(command == "sort-descending")
              {
                button.cssClass = 'icon-sort-descending';
                button.command = 'sort-ascending';
                button.tooltip = 'Sort ascending';
                set_sort(column.id, "descending");
              }
            });

            self.grid.registerPlugin(header_buttons);
            self.grid.registerPlugin(new Slick.AutoTooltips({enableForHeaderCells:true}));

            self.grid.setSelectionModel(new Slick.RowSelectionModel());

            self.grid.onSelectedRowsChanged.subscribe(function(e, selection)
            {
              // Don't trigger a selection event unless the selection was changed by user interaction (i.e. not outside callers or changing the sort order).
              if(self.trigger_row_selection)
              {
                var waveform_indexes=[];
                for(var i=0; i<selection.rows.length; i++){
                  waveform_indexes.push( self.grid.getDataItem(selection.rows[i])[self.options.metadata["column-count"]-1] );
                }
                self.options["row-selection"] = waveform_indexes;
                self.element.trigger("row-selection-changed", [waveform_indexes]);
              }
              self.trigger_row_selection = true;
            });

            self.grid.onHeaderClick.subscribe(function (e, args)
            {
              if(!self._array_equal([args.column.field], self.options["variable-selection"]))
              {
                self.options["variable-selection"] = [args.column.field];
                self._color_variables(self.options["variable-selection"]);
                self.element.trigger("variable-selection-changed", { variable:self.options["variable-selection"], colormap:args.column.colormap, });
              }
            });

            self._color_variables(self.options["variable-selection"]);

            self.grid.init();

            if(self.options["row-selection"].length > 0){
              var selectedRows = self.data.getSimulationRowIndexes(self.options["row-selection"]);
              self.trigger_row_selection = false;
              self.grid.setSelectedRows(selectedRows);
              self.grid.resetActiveCell();
              if(selectedRows.length)
                self.grid.scrollRowToTop(Math.min.apply(Math, selectedRows));
            }
          }

          self.data.onDataLoaded.subscribe(function (e, args) {
            for (var i = args.from; i <= args.to; i++) {
              self.grid.invalidateRow(i);
            }
            self.grid.render();
          });
        }

        if(self.options["sort-variable"] !== null && self.options["sort-order"] !== null && self.options.table_filter.length > 0) {
          // Need to retrieve the sorted_table_filter first because everything else relies on it.

          if( self.options["sort-variable"] == self.options.metadata["column-count"]-1 )
          {
            // we are sorting by the index column, so we can just make the data we need.
            initialize_grid( new Int32Array( d3.range(self.options.metadata["row-count"]) ) );
          }
          else
          {
            var request = new XMLHttpRequest();
            request.open("GET", self.options["server-root"] + "models/" + self.options.mid + "/arraysets/" + self.options.aid + "/data?hyperchunks=0/rank(a" + self.options["sort-variable"] + ',"asc")/...&byteorder=' + (is_little_endian() ? "little" : "big") );
            request.responseType = "arraybuffer";
            request.onload = function(e)
            {
              var indices = [];
              var data = new Int32Array(this.response);
              // Filtering out every other element in the reponse array, because it's full of extraneous 0 (zeros) for some reason.
              // Need to figure out why, but this is a fix for now.
              for(var i=0; i<data.length; i=i+2)
              {
                indices.push(data[i]);
              }
              indices = new Int32Array(indices);

              initialize_grid(indices);
            }
            request.send();
          }
        }
        else
        {
          initialize_grid();
        }
        
      }
      else if(key == "sort-variable")
      {
        self.options[key] = value;
        if(value === null) {
          self.options["sort-order"] = null
        }
        set_sort(self.options["sort-variable"], self.options["sort-order"]);
        // Set all column header buttons to "sort-off" state
        for(var i in self.columns)
        {
          self.columns[i].header.buttons[0].cssClass = "icon-sort-off";
          self.columns[i].header.buttons[0].tooltip = "Sort ascending";
          self.columns[i].header.buttons[0].command = "sort-ascending";
          self.grid.updateColumnHeader(self.columns[i].id);
        }
      }
    },

    _color_variables: function(variables)
    {
      var self = this;

      var columns = self.grid.getColumns();
      for(var i in columns)
      {
        var column = columns[i];
        if(self.options.colormap !== null && $.inArray(column.id, variables) != -1)
        {
          // Make a copy of our global colormap, then adjust its domain to match our column-specific data.
          column.colormap = self.options.colormap.copy();

          var new_domain = []
          var domain_scale = d3.scale.linear().domain([0, column.colormap.range().length]).range([self.options.metadata["column-min"][column.id], self.options.metadata["column-max"][column.id]]);
          for(var i in column.colormap.range())
            new_domain.push(domain_scale(i));
          column.colormap.domain(new_domain);

          column.cssClass = column.cssClass.split(" ")[0] + " highlight";
          column.highlighted = true;
        }
        else
        {
          column.colormap = null;
          column.cssClass = column.cssClass.split(" ")[0];
          column.highlighted = false;
        }
      }

      self.grid.invalidate();
    },

    _data_provider: function(parameters)
    {
      var self = this;

      self.server_root = parameters.server_root
      self.mid = parameters.mid;
      self.aid = parameters.aid;
      self.metadata = parameters.metadata;
      self.sort_column = parameters.sort_column;
      self.sort_order = parameters.sort_order;
      self.table_filter = parameters.table_filter;
      if(parameters.sorted_table_filter == undefined)
        self.sorted_table_filter = parameters.table_filter;
      else
        self.sorted_table_filter = parameters.sorted_table_filter;
      if(parameters.retrieve_table_filter == undefined)
        self.retrieve_table_filter = parameters.table_filter;
      else
        self.retrieve_table_filter = parameters.retrieve_table_filter;
      self.row_count = parameters.row_count;
      self.ranked_indices = {};

      self.pages = {};
      self.pages_in_progress = {};
      self.page_size = 50;

      self.onDataLoaded = new Slick.Event();

      self.get_indices_old = function(sortedUnsorted, rows, callback, asynchronous)
      {
        if(asynchronous != false)
          asynchronous = true;

        if(rows.length == 0)
        {
          callback([]);
          return;
        }

        var sort = "";
        if(self.sort_column !== null && self.sort_order !== null)
          sort = "&sort=" + self.sort_column + ":" + self.sort_order;

        var row_string = "";
        for(var i = 0; i < rows.length; ++i)
        {
          row_string += rows[i];
          break
        }
        for(var i = 1; i < rows.length; ++i)
        {
          row_string += ",";
          row_string += rows[i];
        }

        function is_little_endian()
        {
          if(this.result === undefined)
            this.result = ((new Uint32Array((new Uint8Array([1,2,3,4])).buffer))[0] === 0x04030201);
          return this.result;
        }

        // XMLHttpRequest does not support synchronous retrieval with arraybuffer, so falling back to ajax with no arraybuffer for initial synchronous sorted table filter retrieval.
        if(asynchronous){
          var request = new XMLHttpRequest();
          request.open("GET", self.server_root + "models/" + self.mid + "/tables/" + self.aid + "/arrays/0/" + sortedUnsorted + "-indices?rows=" + row_string + "&index=Index&byteorder=" + (is_little_endian() ? "little" : "big") + sort);
          request.responseType = "arraybuffer";
          request.callback = callback;
          request.onload = function(e)
          {
            this.callback(new Int32Array(this.response));
          }
          request.send();
        } else {
          $.ajax(
          {
            type : "GET",
            url : self.server_root + "models/" + self.mid + "/tables/" + self.aid + "/arrays/0/" + sortedUnsorted + "-indices?rows=" + row_string + "&index=Index" + sort,
            async : false,
            callback : callback,
            success : function(data)
            {
              this.callback(new Int32Array(data));
            },
          });
        }
      }

      self.get_indices = function(direction, rows, callback)
      {
        if(rows.length == 0)
        {
          callback([]);
          return;
        }
        // We have no sort column or order, so just returning the same rows as were asked for since they're in the same order
        if(self.sort_column == null || self.sort_order == null)
        {
          callback(rows);
        }
        else
        {
          if(self.ranked_indices[self.sort_column])
          {
            // we have data for this column, so figure out what to return
            var indices = self.ranked_indices[self.sort_column];
            // Reverse response indexes for descending sort order
            if(self.sort_order == 'descending')
            {
              var plain_array = [];
              for(var i=0; i<indices.length; i++)
              {
                plain_array.push(indices[i]);
              }
              indices = plain_array.reverse();
            }
            var response = []; 
            for(var i=0; i<rows.length; i++)
            {
              if(direction == "unsorted")
              {
                response.push( indices[ rows[i] ] );
              }
              else if(direction == "sorted")
              {
                response.push( indices.indexOf(rows[i]) );
              }
            }
            callback(new Int32Array(response));
          }
          else
          {
            if( self.sort_column == self.metadata["column-count"]-1 )
            {
              // we are sorting by the index column, so we can just make the data we need.
              self.ranked_indices[self.sort_column] = new Int32Array( d3.range(self.metadata["row-count"]) );
              self.get_indices(direction, rows, callback);
            }
            else
            {
              // we have no data for this column, so go retrieve it and call this function again.
              var request = new XMLHttpRequest();
              request.open("GET", self.server_root + "models/" + self.mid + "/arraysets/" + self.aid + "/data?hyperchunks=0/rank(a" + self.sort_column + ',"asc")/...&byteorder=' + (is_little_endian() ? "little" : "big") );
              request.responseType = "arraybuffer";
              request.direction = direction;
              request.rows = rows;
              request.callback = callback;
              request.onload = function(e)
              {
                var indices = [];
                var data = new Int32Array(this.response);
                // Filtering out every other element in the reponse array, because it's full of extraneous 0 (zeros) for some reason.
                // Need to figure out why, but this is a fix for now.
                for(var i=0; i<data.length; i=i+2)
                {
                  indices.push(data[i]);
                }
                self.ranked_indices[self.sort_column] = new Int32Array(indices);
                self.get_indices(this.direction, this.rows, this.callback);
              }
              request.send();
            }
          }
        }

        function is_little_endian()
        {
          if(this.result === undefined)
            this.result = ((new Uint32Array((new Uint8Array([1,2,3,4])).buffer))[0] === 0x04030201);
          return this.result;
        }
      }

      self.setGrid = function(grid)
      {
        self.grid = grid;
      }

      self.getLength = function()
      {
        return self.row_count;
      }

      self.getItem_old = function(index)
      {
        var column_begin = 0;
        var column_end = self.metadata["column-count"];
        var page = Math.floor(index / self.page_size);
        var page_begin = page * self.page_size;

        if(!(page in self.pages))
        {
          var row_begin = page_begin;
          var row_end = (page + 1) * self.page_size;

          var sort = "";
          if(self.sort_column !== null && self.sort_order !== null) {
            sort = "&sort=" + self.sort_column + ":" + self.sort_order;
          }
          
          var rowsToRetrieve = self.retrieve_table_filter.slice(row_begin, row_end ).join(',');

          $.ajax(
          {
            type : "GET",
            url : self.server_root + "models/" + self.mid + "/tables/" + self.aid + "/arrays/0/chunk?rows=" + rowsToRetrieve + "&columns=" + column_begin + "-" + column_end + "&index=Index" + sort,
            async : false,
            success : function(data)
            {
              self.pages[page] = data;
            },
            error: function(request, status, reason_phrase)
            {
              console.log("error", request, status, reason_phrase);
            }
          });
        }

        result = {};
        for(var i = column_begin; i != column_end; ++i)
          result[i] = self.pages[page].data[i][index - page_begin];
        return result;
      }

      self.getItem = function(index)
      {
        var column_begin = 0;
        var column_end = self.metadata["column-count"];
        var page = Math.floor(index / self.page_size);
        var page_begin = page * self.page_size;

        if(self.pages_in_progress[page])
        {
          return null;
        }

        if(!(page in self.pages))
        {
          self.pages_in_progress[page] = true;
          var row_begin = page_begin;
          var row_end = (page + 1) * self.page_size;

          var rowsToRetrieve = self.retrieve_table_filter.slice(row_begin, row_end ).join('|');

          var sort = "";
          if(self.sort_column !== null && self.sort_order !== null)
          {
            var sort_column = "a" + self.sort_column;
            var sort_order = self.sort_order;
            if(sort_order == 'ascending')
            {
              sort_order = 'asc';
            }
            else if(sort_order == 'descending')
            {
              sort_order = 'desc';
            }
            if(self.sort_column == self.metadata["column-count"]-1)
              sort_column = "index(0)";
            sort = "/order: rank(" + sort_column + ', "' + sort_order + '")';
          }

          $.ajax(
          {
            type : "GET",
            url : self.server_root + "models/" + self.mid + "/arraysets/" + self.aid + "/data?hyperchunks=0/" + column_begin + ":" + (column_end - 1) + "|index(0)" + sort + "/" + rowsToRetrieve,
            success : function(data)
            {
              self.pages[page] = [];
              var columns = column_end - column_begin;
              var rows = data.length / columns;
              for(var row = 0; row < rows; row++)
              {
                result = {};
                for(var column = column_begin; column != column_end; ++column)
                {
                  result[column] = data[  ((column - column_begin) * rows) + row  ];
                }
                self.pages[page].push(result);
              }
              self.pages_in_progress[page] = false;
              self.onDataLoaded.notify({from: row_begin, to: row_end});
            },
            error: function(request, status, reason_phrase)
            {
              console.log("error", request, status, reason_phrase);
            }
          });
          return null;
        }

        return self.pages[page][index - page_begin];
      }

      self.getItemMetadata = function(index)
      {
        return null;
      }

      self.set_sort = function(column, order, callback)
      {
        if(column == self.sort_column && order == self.sort_order) {
          return;
        }
        else if(column==null || order==null){
          self.sort_column = column;
          self.sort_order = order;
          self.sorted_table_filter = self.table_filter;
          self.retrieve_table_filter = self.table_filter;
          self.pages = {};
          self.grid.invalidate();
          callback();
        }
        else {
          self.sort_column = column;
          self.sort_order = order;
          self.get_indices("sorted", self.table_filter, function(sorted_rows){
            if(sorted_rows.length > 1)
              self.sorted_table_filter = Array.apply( [], sorted_rows );
            else
              self.sorted_table_filter = [sorted_rows[0]];
            self.retrieve_table_filter = self.sorted_table_filter.slice(0).sort(function (a, b) { return a - b });
            self.pages = {};
            self.grid.invalidate();
            callback();
          });
        }
      }

      self.getSimulationRowIndexes = function(simulation_indexes)
      {
        var table_filter_index, sorted_table_filter_element, retrieve_table_filter_index;
        var result = [];
        for(var i=0; i<simulation_indexes.length; i++) {
          table_filter_index = self.table_filter.indexOf(simulation_indexes[i]);
          if(table_filter_index > -1){
            sorted_table_filter_element = self.sorted_table_filter[table_filter_index];
            retrieve_table_filter_index = self.retrieve_table_filter.indexOf(sorted_table_filter_element);
            result.push(retrieve_table_filter_index);
          }
        }
        return result;
      }

    },

    _array_equal: function(a, b)
    {
      return $(a).not(b).length == 0 && $(b).not(a).length == 0;
    },
  });

});