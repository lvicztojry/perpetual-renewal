/* global Component */
Component({
  properties: { schema: Array, values: Object, disabled: Boolean },
  observers: {
    'schema, values.**': function () {
      const values=this.data.values || {};
      this.setData({renderFields:(this.data.schema || []).map(field=>({...field,display:field.options?.find(option=>option.value===values[field.key])?.label || values[field.key] || '请选择'}))});
    }
  },
  methods: {
    change(event) {
      const field = this.data.schema.find(f => f.key === event.currentTarget.dataset.key);
      let value = event.detail.value;
      if (field.type === 'select') value = field.options[Number(value)].value;
      if (field.type === 'number') value = value === '' ? '' : Number(value);
      this.triggerEvent('edit', { key: field.key, value });
    }
  }
});
